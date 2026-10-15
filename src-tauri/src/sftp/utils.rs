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

/// Создаёт каталог назначения для папочной загрузки, если его ещё нет.
/// Возвращает `true`, если именно эта передача создала каталог.
pub async fn ensure_remote_directory(sftp: &SftpSession, path: &str) -> Result<bool, String> {
    let normalized = normalize_remote_path(path);
    match sftp.metadata(normalized.clone()).await {
        Ok(metadata) if is_dir(&metadata) => Ok(false),
        Ok(_) => Err(format!("Remote path is not a directory: {normalized}")),
        Err(err) if is_no_such_file(&err.to_string()) => {
            sftp.create_dir(normalized).await.map_err(|err| err.to_string())?;
            Ok(true)
        }
        Err(err) => Err(err.to_string()),
    }
}

/// Проверяет, что удалённое имя остаётся одним компонентом локального пути.
/// На POSIX обратный слэш допустим в имени, но на Windows он разделяет путь.
pub fn validate_local_filename(filename: &str) -> Result<&str, String> {
    if filename.is_empty()
        || filename == "."
        || filename == ".."
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains(':')
        || filename.contains('\0')
    {
        return Err(crate::i18n::t("errors.invalidRemoteFilename", &[]));
    }
    Ok(filename)
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
            Box::pin(remove_remote_path_strict(sftp, &item_path)).await?;
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
            Box::pin(merge_and_remove_remote_dir(sftp, &source_item, &dest_item)).await?;
        } else {
            Box::pin(promote_remote_path(sftp, &source_item, &dest_item)).await?;
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
            Box::pin(collect_local_size(&path, visited, depth + 1, total)).await;
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
            total += Box::pin(remote_folder_size(sftp, &item_path, depth + 1)).await;
        } else {
            total += metadata.size.unwrap_or(0);
        }
    }
    total
}

/// Запускает приложение и возвращает дочерний процесс, если его завершение
/// можно использовать как сигнал закрытия редактора.
pub fn launch_application_for_file_tracked(
    application_path: &str,
    file_path: &str,
) -> Result<Option<std::process::Child>, &'static str> {
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
            ])?;
            // macOS `open` exits after handing off the request, not when the
            // editor window closes, so its child handle is not a valid signal.
            return Ok(None);
        }
    }

    let child = spawn_detached(
        &absolute_application.to_string_lossy(),
        &[absolute_file.to_string_lossy().to_string()],
    )?;
    Ok(Some(child))
}

fn spawn_detached(program: &str, args: &[String]) -> Result<std::process::Child, &'static str> {
    use std::process::{Command, Stdio};

    let result = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    match result {
        Ok(child) => Ok(child),
        Err(err) => {
            logger::warn("SFTP", &format!("Failed to launch {program}: {err}"));
            Err("APP_NOT_FOUND")
        }
    }
}

/// Открывает файл системным приложением и завершает watcher по закрытию
/// процесса, если Windows запустила отдельный процесс для этого файла.
#[cfg(windows)]
pub fn open_default_application_for_file(
    file_path: &str,
    cancel: tokio::sync::watch::Sender<bool>,
) -> Result<(), &'static str> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::WaitForSingleObject;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let path: Vec<u16> = std::ffi::OsStr::new(file_path).encode_wide().chain(Some(0)).collect();
    let verb = [b'o' as u16, b'p' as u16, b'e' as u16, b'n' as u16, 0];
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = path.as_ptr();
    info.nShow = SW_SHOWNORMAL;

    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err("APP_NOT_FOUND");
    }
    if info.hProcess.is_null() {
        // ShellExecuteEx may use DDE to activate an existing process and return
        // no handle. The watcher remains tied to file deletion/session close.
        return Ok(());
    }

    let process = info.hProcess as usize;
    let launched_at = std::time::Instant::now();
    let mut cancelled = cancel.subscribe();
    let completed_cancel = cancel.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if *cancelled.borrow() {
                unsafe { CloseHandle(process as windows_sys::Win32::Foundation::HANDLE) };
                break;
            }
            let status = unsafe {
                WaitForSingleObject(process as windows_sys::Win32::Foundation::HANDLE, 0)
            };
            if status != WAIT_TIMEOUT {
                unsafe { CloseHandle(process as windows_sys::Win32::Foundation::HANDLE) };
                if launched_at.elapsed() >= std::time::Duration::from_secs(2) {
                    completed_cancel.send_replace(true);
                }
                break;
            }
            tokio::select! {
                _ = cancelled.changed() => {},
                _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {},
            }
        }
    });

    Ok(())
}

#[cfg(test)]
#[path = "../tests/sftp_utils.rs"]
mod tests;
