//! Файловые операции SFTP — порт `SftpFileService.ts` и `sftp-operations.ts`.
//!
//! Формат записи `SftpFileEntry` повторяет `ssh2`: `attrs` содержит полный
//! `st_mode` (вместе с битами типа файла), потому что рендерер определяет
//! каталог/файл/симлинк через `mode & 0o170000`.

use std::path::Path;
use std::sync::Arc;

use russh_sftp::client::SftpSession;
use serde::Serialize;

use crate::i18n;
use crate::sftp::utils;

/// Атрибуты файла в формате `ssh2` (совпадает с `SftpFileEntry['attrs']`).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct FileAttrs {
    pub mode: u32,
    pub uid: u32,
    pub gid: u32,
    pub size: u64,
    pub atime: u32,
    pub mtime: u32,
}

impl From<&russh_sftp::client::fs::Metadata> for FileAttrs {
    fn from(metadata: &russh_sftp::client::fs::Metadata) -> Self {
        FileAttrs {
            mode: metadata.permissions.unwrap_or(0),
            uid: metadata.uid.unwrap_or(0),
            gid: metadata.gid.unwrap_or(0),
            size: metadata.size.unwrap_or(0),
            atime: metadata.atime.unwrap_or(0),
            mtime: metadata.mtime.unwrap_or(0),
        }
    }
}

/// Элемент каталога в формате `SftpFileEntry`.
#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub filename: String,
    pub longname: String,
    pub attrs: FileAttrs,
    /// Атрибуты цели симлинка (для отображения «ссылка на …»).
    #[serde(rename = "targetAttrs", skip_serializing_if = "Option::is_none")]
    pub target_attrs: Option<FileAttrs>,
}

/// Результат локального `stat` (`FsStatResult`).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct FsStatResult {
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
}

fn is_dir_mode(mode: u32) -> bool {
    mode & 0o170_000 == 0o040_000
}

/// Чтение каталога с разрешением симлинков и сортировкой «каталоги первыми».
pub async fn readdir(sftp: &SftpSession, path: &str) -> Result<Vec<FileEntry>, String> {
    let entries = match sftp.read_dir(path.to_owned()).await {
        Ok(entries) => entries,
        Err(err) => return Err(i18n::t("errors.readdirError", &[("message", &err.to_string())])),
    };

    let mut result: Vec<FileEntry> = Vec::with_capacity(entries.len());
    for entry in entries {
        let filename = entry.file_name();
        if filename == "." || filename == ".." {
            continue;
        }
        let metadata = entry.metadata();
        let attrs = FileAttrs::from(&metadata);

        // Симлинк читаем отдельно, чтобы UI показал содержимое ссылки.
        let target_attrs = if utils::is_symlink(&metadata) {
            let full_path = utils::normalize_remote_path(&format!("{path}/{filename}"));
            sftp.metadata(full_path).await.ok().map(|target| FileAttrs::from(&target))
        } else {
            None
        };

        result.push(FileEntry {
            longname: longname(&filename, &metadata),
            filename,
            attrs,
            target_attrs,
        });
    }

    result.sort_by(|left, right| {
        right
            .attrs
            .mode
            .is_dir_mode()
            .cmp(&left.attrs.mode.is_dir_mode())
            .then_with(|| left.filename.to_lowercase().cmp(&right.filename.to_lowercase()))
    });
    Ok(result)
}

trait ModeExt {
    fn is_dir_mode(&self) -> bool;
}

impl ModeExt for u32 {
    fn is_dir_mode(&self) -> bool {
        is_dir_mode(*self)
    }
}

/// Воспроизводит колонку `longname` в формате `ls -l`.
fn longname(filename: &str, metadata: &russh_sftp::client::fs::Metadata) -> String {
    let mode = metadata.permissions.unwrap_or(0);
    let size = metadata.size.unwrap_or(0);
    let uid = metadata.uid.unwrap_or(0);
    let gid = metadata.gid.unwrap_or(0);
    format!("{mode:o} 1 {uid} {gid} {size:>12} {filename}")
}

pub async fn realpath(sftp: &SftpSession, path: &str) -> Result<String, String> {
    sftp.canonicalize(path.to_owned()).await.map_err(|err| err.to_string())
}

pub async fn mkdir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.create_dir(path.to_owned())
        .await
        .map_err(|err| i18n::t("errors.mkdirError", &[("message", &err.to_string())]))
}

pub async fn rename(sftp: &SftpSession, old_path: &str, new_path: &str) -> Result<(), String> {
    sftp.rename(old_path.to_owned(), new_path.to_owned())
        .await
        .map_err(|err| i18n::t("errors.renameError", &[("message", &err.to_string())]))
}

pub async fn chmod(sftp: &SftpSession, path: &str, mode: u32) -> Result<(), String> {
    let message = |err: String| i18n::t("errors.chmodError", &[("message", &err)]);
    let mut attributes = sftp
        .metadata(path.to_owned())
        .await
        .map_err(|err| message(err.to_string()))?;
    attributes.permissions = Some(mode);
    sftp.set_metadata(path.to_owned(), attributes)
        .await
        .map_err(|err| message(err.to_string()))
}

/// Удаление файла или каталога (рекурсивно для каталога).
pub async fn remove(sftp: &SftpSession, path: &str, is_dir: bool) -> Result<(), String> {
    let result = if is_dir {
        delete_remote_tree(sftp, path, DELETE_CONCURRENCY).await
    } else {
        sftp.remove_file(path.to_owned()).await.map_err(|err| err.to_string())
    };

    result.map_err(|err| {
        let kind = if is_dir {
            i18n::t("sftp.folder", &[]).to_lowercase()
        } else {
            i18n::t("sftp.file", &[]).to_lowercase()
        };
        i18n::t("errors.deleteError", &[("type", &kind), ("message", &err)])
    })
}

/// Одновременных SFTP-операций при рекурсивном удалении.
const DELETE_CONCURRENCY: usize = 16;

/// Рекурсивное удаление с ограничением числа параллельных операций.
///
/// Каталог удаляется только после всех своих детей, симлинки не разворачиваются.
/// Сначала собирается список путей (обход итеративный, стек не растёт), затем
/// элементы удаляются пачками по [`DELETE_CONCURRENCY`]; сортировка по глубине
/// убывающе гарантирует, что ребёнок удаляется раньше родителя.
pub async fn delete_remote_tree(sftp: &SftpSession, root: &str, concurrency: usize) -> Result<(), String> {
    use futures::stream::{self, StreamExt};

    let mut paths = collect_tree(sftp, root).await?;
    paths.sort_by(|left, right| depth_of(&right.0).cmp(&depth_of(&left.0)));

    let mut results = stream::iter(paths.into_iter().map(|(path, is_dir)| {
        async move {
            if is_dir {
                sftp.remove_dir(path).await.map_err(|err| err.to_string())
            } else {
                sftp.remove_file(path).await.map_err(|err| err.to_string())
            }
        }
    }))
    .buffer_unordered(concurrency.max(1));

    while let Some(result) = results.next().await {
        if let Err(err) = result {
            // «Уже нет такого файла» игнорируем: элемент мог исчезнуть между
            // обходом и удалением.
            if !utils::is_no_such_file(&err) {
                return Err(err);
            }
        }
    }

    Ok(())
}

/// Собирает все пути дерева: сначала файлы, затем каталоги.
async fn collect_tree(sftp: &SftpSession, root: &str) -> Result<Vec<(String, bool)>, String> {
    let mut collected: Vec<(String, bool)> = Vec::new();
    let mut directories: Vec<String> = vec![utils::normalize_remote_path(root)];

    while let Some(directory) = directories.pop() {
        let entries = match sftp.read_dir(directory.clone()).await {
            Ok(entries) => entries,
            Err(err) => {
                let text = err.to_string();
                if utils::is_no_such_file(&text) {
                    continue;
                }
                return Err(text);
            }
        };

        for entry in entries {
            let filename = entry.file_name();
            if filename == "." || filename == ".." {
                continue;
            }
            let metadata = entry.metadata();
            let path = utils::normalize_remote_path(&format!("{directory}/{filename}"));
            // Симлинк не разворачивается: удаляется как файл.
            let is_dir = !utils::is_symlink(&metadata) && utils::is_dir(&metadata);
            collected.push((path.clone(), is_dir));
            if is_dir {
                directories.push(path);
            }
        }
    }

    Ok(collected)
}

fn depth_of(path: &str) -> usize {
    path.chars().filter(|ch| *ch == '/').count()
}

/// Локальный `stat` с размером папки (порт `statLocal`).
pub async fn stat_local(file_path: &str) -> Option<FsStatResult> {
    if file_path.is_empty() || file_path.len() > 4096 {
        return None;
    }
    let path = Path::new(file_path);
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) => {
            crate::logger::error("FS", &format!("Error stating file {file_path}: {err}"));
            return None;
        }
    };

    let is_dir = metadata.is_dir();
    let size = if is_dir {
        utils::local_folder_size(path).await
    } else {
        metadata.len()
    };
    Some(FsStatResult { is_dir, size })
}

/// Локальный размер файла (для прогресса прямой загрузки).
pub fn local_file_size(path: &str) -> u64 {
    std::fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0)
}

/// Удобная обёртка владения SFTP-каналом.
pub type SharedSftp = Arc<SftpSession>;
