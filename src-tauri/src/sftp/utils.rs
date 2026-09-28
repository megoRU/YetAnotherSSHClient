//! Утилиты SFTP — порт `electron/src/sftp/sftp-utils.ts`.
//!
//! Здесь живут операции с путями, безопасная «промоция» временного пути и
//! подсчёт размеров. Поведение совпадает с TypeScript-версией: те же
//! нормализация путей, то же имя временного файла, тот же отказ при попытке
//! заменить каталог файлом (и наоборот).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use russh_sftp::client::SftpSession;

use crate::logger;

/// Нормализует удалённый путь: схлопывает повторные слэши, убирает хвостовой.
///
/// `//a//b/` → `/a/b`; `/` → `/`; `/a/` → `/a`.
pub fn normalize_remote_path(path: &str) -> String {
    let collapsed: String = {
        let mut out = String::with_capacity(path.len());
        let mut previous_slash = false;
        for ch in path.chars() {
            if ch == '/' {
                if previous_slash {
                    continue;
                }
                previous_slash = true;
            } else {
                previous_slash = false;
            }
            out.push(ch);
        }
        out
    };
    let trimmed = collapsed.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Временный путь для незавершённой загрузки.
///
/// `<dir>/<name>` → `<dir>/.<name>.uploading-<transferId>`; файл в корне
/// сервера → `/.uploading-<transferId>`.
pub fn temp_remote_path(remote_path: &str, transfer_id: &str) -> String {
    let normalized = normalize_remote_path(remote_path);
    let mut parts: Vec<&str> = normalized.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        return normalize_remote_path(&format!("/.uploading-{transfer_id}"));
    }
    let filename = parts.pop().expect("checked non-empty");
    let parent = if parts.is_empty() {
        String::new()
    } else {
        format!("/{}", parts.join("/"))
    };
    normalize_remote_path(&format!("{parent}/.{filename}.uploading-{transfer_id}"))
}

/// Ошибка «нет такого файла» в разных форматах (код SFTP, errno, текст).
pub fn is_no_such_file(error: &str) -> bool {
    error.contains("No such file")
        || error.contains("ENOENT")
        || error.contains("Status error: 2")
        || error.contains("code: 2")
}

/// Рекурсивное удаление, ошибки пробрасываются.
pub async fn remove_remote_path_strict(sftp: &SftpSession, remote_path: &str) -> Result<(), String> {
    let normalized = normalize_remote_path(remote_path);

    let metadata = match sftp.metadata(normalized.clone()).await {
        Ok(metadata) => metadata,
        Err(err) => {
            let text = err.to_string();
            if is_no_such_file(&text) {
                return Ok(());
            }
            return Err(text);
        }
    };

    if is_dir(&metadata) {
        let entries = match sftp.read_dir(normalized.clone()).await {
            Ok(entries) => entries,
            Err(err) => {
                let text = err.to_string();
                if is_no_such_file(&text) {
                    return Ok(());
                }
                return Err(text);
            }
        };
        for entry in entries {
            let filename = entry.file_name();
            if filename == "." || filename == ".." {
                continue;
            }
            let item_path = normalize_remote_path(&format!("{normalized}/{filename}"));
            remove_remote_path_strict(sftp, &item_path).await?;
        }
        if let Err(err) = sftp.remove_dir(normalized).await {
            let text = err.to_string();
            if !is_no_such_file(&text) {
                return Err(text);
            }
        }
    } else if let Err(err) = sftp.remove_file(normalized).await {
        let text = err.to_string();
        if !is_no_such_file(&text) {
            return Err(text);
        }
    }

    Ok(())
}

/// Рекурсивное удаление «по возможности»: ошибки только логируются.
///
/// Используется при отмене загрузки и при сбое промоции — там важно дойти до
/// конца, а не прерваться на первом недоступном элементе.
pub async fn remove_remote_path(sftp: &SftpSession, remote_path: &str) {
    if let Err(err) = remove_remote_path_strict(sftp, remote_path).await {
        logger::warn("SFTP", &format!("Best-effort cleanup failed for {remote_path}: {err}"));
    }
}

/// Признак каталога по SFTP-атрибутам (`mode & 0o170000 == 0o040000`).
pub fn is_dir(metadata: &russh_sftp::client::fs::Metadata) -> bool {
    metadata.permissions.map(|mode| mode & 0o170_000 == 0o040_000).unwrap_or(false)
}

/// Признак симлинка (`mode & 0o170000 == 0o120000`).
pub fn is_symlink(metadata: &russh_sftp::client::fs::Metadata) -> bool {
    metadata.permissions.map(|mode| mode & 0o170_000 == 0o120_000).unwrap_or(false)
}

/// Слияние каталогов при промоции: содержимое `source` переносится в `dest`.
async fn merge_and_remove_remote_dir(sftp: &SftpSession, source_dir: &str, dest_dir: &str) -> Result<(), String> {
    let entries = sftp.read_dir(source_dir.to_owned()).await.map_err(|err| err.to_string())?;
    for entry in entries {
        let filename = entry.file_name();
        if filename == "." || filename == ".." {
            continue;
        }
        let source_item = normalize_remote_path(&format!("{source_dir}/{filename}"));
        let dest_item = normalize_remote_path(&format!("{dest_dir}/{filename}"));
        let item_is_dir = is_dir(&entry.metadata());

        if item_is_dir {
            let dest_is_dir = match sftp.metadata(dest_item.clone()).await {
                Ok(metadata) => is_dir(&metadata),
                Err(_) => false,
            };
            if !dest_is_dir {
                if let Err(err) = sftp.create_dir(dest_item.clone()).await {
                    let text = err.to_string();
                    let already_exists = text.contains("EEXIST") || text.contains("Status error: 4") || text.contains("code: 4");
                    if !already_exists {
                        return Err(text);
                    }
                }
            }
            merge_and_remove_remote_dir(sftp, &source_item, &dest_item).await?;
        } else {
            promote_remote_path(sftp, &source_item, &dest_item).await?;
        }
    }
    sftp.remove_dir(source_dir.to_owned()).await.map_err(|err| err.to_string())
}

/// Переносит временный путь на целевой, разрешая коллизии.
///
/// Сценарии (в этом порядке):
/// 1. `rename` сработал — готово;
/// 2. целевого нет — исходная ошибка `rename` пробрасывается;
/// 3. обе стороны — каталоги → рекурсивное слияние;
/// 4. обе стороны — файлы → резервная копия целевого, `rename`, откат при
///    неудаче, удаление резервной копии при успехе;
/// 5. типы не совпадают (файл ↔ каталог) — явный отказ.
pub async fn promote_remote_path(sftp: &SftpSession, temp_path: &str, target_path: &str) -> Result<(), String> {
    let temp = normalize_remote_path(temp_path);
    let target = normalize_remote_path(target_path);

    let rename_result = sftp.rename(temp.clone(), target.clone()).await;
    if rename_result.is_ok() {
        return Ok(());
    }
    let rename_error = rename_result
        .err()
        .map(|err| err.to_string())
        .unwrap_or_else(|| "rename failed".to_owned());

    let target_is_dir = match sftp.metadata(target.clone()).await {
        Ok(metadata) => is_dir(&metadata),
        // Цели нет — исходная ошибка rename фатальна.
        Err(_) => return Err(rename_error),
    };
    let temp_is_dir = match sftp.metadata(temp.clone()).await {
        Ok(metadata) => is_dir(&metadata),
        Err(_) => false,
    };

    if target_is_dir && temp_is_dir {
        return merge_and_remove_remote_dir(sftp, &temp, &target).await;
    }

    if !target_is_dir && !temp_is_dir {
        let backup = format!("{target}.target.backup-{}", crate::paths::new_uuid());
        if sftp.rename(target.clone(), backup.clone()).await.is_err() {
            // Не смогли сделать резервную копию — исходный файл не трогаем.
            return Err(rename_error);
        }

        if let Err(promote_error) = sftp.rename(temp, target.clone()).await {
            // Промоция не удалась — возвращаем исходный файл на место.
            if let Err(restore_error) = sftp.rename(backup.clone(), target.clone()).await {
                logger::error(
                    "SFTP",
                    &format!("Failed to restore target backup {backup} to {target}: {restore_error}"),
                );
            }
            return Err(promote_error.to_string());
        }

        if let Err(unlink_error) = sftp.remove_file(backup.clone()).await {
            logger::warn("SFTP", &format!("Failed to clean up target backup {backup}: {unlink_error}"));
        }
        return Ok(());
    }

    Err(format!(
        "Cannot overwrite {} with {}",
        if target_is_dir { "directory" } else { "file" },
        if temp_is_dir { "directory" } else { "file" }
    ))
}

/// Экранирует путь для одиночных кавычек в удалённой команде.
pub fn escape_remote_path(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

/// Расширение файла в нижнем регистре, с точкой (`.rs`).
pub fn normalized_extension(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

/// Размер локального каталога (симлинки не разворачиваются).
pub async fn local_folder_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    let mut visited: HashSet<PathBuf> = HashSet::new();
    let Ok(canonical) = std::fs::canonicalize(dir) else { return 0 };
    if !visited.insert(canonical) {
        return 0;
    }
    collect_local_size(dir, &mut visited, 0, &mut total).await;
    total
}

async fn collect_local_size(dir: &Path, visited: &mut HashSet<PathBuf>, depth: usize, total: &mut u64) {
    if depth > 20 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else { continue };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            let Ok(canonical) = std::fs::canonicalize(&path) else { continue };
            if !visited.insert(canonical) {
                continue;
            }
            collect_local_size(&path, visited, depth + 1, total).await;
        } else {
            *total += metadata.len();
        }
    }
}

/// Размер удалённого каталога (симлинки пропускаются).
pub async fn remote_folder_size(sftp: &SftpSession, remote_path: &str, depth: usize) -> u64 {
    if depth > 20 {
        return 0;
    }
    let entries = match sftp.read_dir(remote_path.to_owned()).await {
        Ok(entries) => entries,
        Err(err) => {
            logger::warn(
                "SFTP",
                &format!("Error calculating remote folder size for {remote_path}: {err}"),
            );
            return 0;
        }
    };

    let mut total = 0u64;
    for entry in entries {
        let filename = entry.file_name();
        if filename == "." || filename == ".." {
            continue;
        }
        let metadata = entry.metadata();
        if is_symlink(&metadata) {
            continue;
        }
        let item_path = normalize_remote_path(&format!("{remote_path}/{filename}"));
        if is_dir(&metadata) {
            total += remote_folder_size(sftp, &item_path, depth + 1).await;
        } else {
            total += metadata.size.unwrap_or(0);
        }
    }
    total
}

/// Запускает приложение для файла. `APP_NOT_FOUND` — приложение не найдено.
pub fn launch_application_for_file(application_path: &str, file_path: &str) -> Result<(), &'static str> {
    let absolute_application = std::fs::canonicalize(application_path)
        .map_err(|_| "APP_NOT_FOUND")?;
    let absolute_file = std::fs::canonicalize(file_path).map_err(|_| "APP_NOT_FOUND")?;

    #[cfg(target_os = "macos")]
    {
        if absolute_application
            .to_string_lossy()
            .to_lowercase()
            .ends_with(".app")
        {
            spawn_detached("open", &[
                "-a".to_owned(),
                absolute_application.to_string_lossy().to_string(),
                absolute_file.to_string_lossy().to_string(),
            ]);
            return Ok(());
        }
    }

    spawn_detached(
        &absolute_application.to_string_lossy(),
        &[absolute_file.to_string_lossy().to_string()],
    );
    Ok(())
}

fn spawn_detached(program: &str, args: &[String]) {
    use std::process::{Command, Stdio};

    let result = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    if let Err(err) = result {
        logger::warn("SFTP", &format!("Failed to launch {program}: {err}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn нормализует_пути() {
        assert_eq!(normalize_remote_path("//a//b/"), "/a/b");
        assert_eq!(normalize_remote_path("/"), "/");
        assert_eq!(normalize_remote_path("/a/"), "/a");
        assert_eq!(normalize_remote_path("a/b"), "a/b");
    }

    #[test]
    fn строит_временный_путь() {
        assert_eq!(temp_remote_path("/srv/data/file.txt", "t1"), "/srv/data/.file.txt.uploading-t1");
        assert_eq!(temp_remote_path("/file.txt", "t2"), "/.file.txt.uploading-t2");
        assert_eq!(temp_remote_path("/", "t3"), "/.uploading-t3");
    }

    #[test]
    fn экранирует_кавычки() {
        assert_eq!(escape_remote_path("/tmp/a'b"), "'/tmp/a'\\''b'");
    }

    #[test]
    fn извлекает_расширение() {
        assert_eq!(normalized_extension("Main.RS"), ".rs");
        assert_eq!(normalized_extension("noext"), "");
    }
}
