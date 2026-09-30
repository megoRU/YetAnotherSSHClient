//! Передачи файлов SFTP — порт `sftp-transfer-worker.ts`,
//! `SftpUploadService.ts` и `SftpDownloadService.ts`.
//!
//! Отличие от Electron-версии намеренное: вместо отдельного
//! `utilityProcess` трансферы выполняются задачами tokio на файловых
//! буферах (`spawn_blocking` для диска). Граница процесса в Tauri
//! не нужна — главный поток webview и так не занимает ввод-вывод, а
//! поведение (собственный SFTP-канал на трансфер, отмена, промоут
//! временного пути, агрегированный прогресс) сохранено один в один.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::logger;
use crate::sftp::progress::{ratio_progress, AggregateState, ProgressBatcher, ProgressReporter};
use crate::sftp::utils;

/// Размер буфера чтения/записи при передаче файла.
const CHUNK: usize = 64 * 1024;

/// Направление передачи.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Upload,
    Download,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Upload => "upload",
            Direction::Download => "download",
        }
    }
}

/// Результат передачи (совпадает с `SftpUploadResult` / `SftpDownloadResult`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOutcome {
    pub remote_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dir: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<TransferOutcome>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

/// Контекст передачи: всё общее между upload/download.
pub struct TransferContext {
    pub app: AppHandle,
    pub session_id: String,
    pub transfer_id: String,
    pub direction: Direction,
    pub batcher: Arc<ProgressBatcher>,
    /// Признак активности; при `false` передача считается отменённой.
    pub is_active: Arc<dyn Fn() -> bool + Send + Sync>,
    /// Агрегатор прогресса для многофайловой передачи.
    pub aggregate: Option<AggregateState>,
}

impl TransferContext {
    /// Активна ли передача.
    pub fn active(&self) -> bool {
        (self.is_active)()
    }

    /// Сообщает прогресс с троттлингом.
    pub async fn report(
        &self,
        reporter: &mut ProgressReporter,
        remote_path: &str,
        transferred: u64,
        total: u64,
        fallback: u32,
    ) {
        if !self.active() {
            return;
        }
        let (progress, transferred, total, path) = match self.aggregate.as_ref() {
            Some(state) => (state.percent(), state.transferred, state.total, state.root_path.clone()),
            None => (
                ratio_progress(transferred, total, fallback),
                transferred,
                total,
                remote_path.to_owned(),
            ),
        };
        reporter
            .emit(
                &self.app,
                &self.batcher,
                &path,
                progress,
                Some(transferred),
                Some(total),
            )
            .await;
    }
}

/// Загрузка одного файла на сервер.
///
/// `remote_path` — временный путь; промоут делает вызывающий код.
pub async fn put_file(
    context: &TransferContext,
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
) -> Result<u64, String> {
    let metadata_path = PathBuf::from(local_path);
    let total = tokio::task::spawn_blocking(move || std::fs::metadata(metadata_path).map(|m| m.len()))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;

    let mut file = sftp.create(remote_path.to_owned()).await.map_err(|err| err.to_string())?;

    let local = PathBuf::from(local_path);
    let (mut sender, mut receiver) = tokio::sync::mpsc::channel::<Vec<u8>>(4);
    let reader_local = local.clone();

    // Чтение локального файла уходит в отдельный поток, чтобы медленный диск
    // не блокировал сетевые запросы SFTP.
    let reader = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Read as _;
        let mut handle = std::fs::File::open(reader_local)?;
        let mut buffer = vec![0u8; CHUNK];
        loop {
            let read = handle.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            if sender.blocking_send(buffer[..read].to_vec()).is_err() {
                break;
            }
        }
        Ok(())
    });

    let mut transferred = 0u64;
    let mut reporter = ProgressReporter::new(&context.session_id, &context.transfer_id, "upload");
    while let Some(chunk) = receiver.recv().await {
        if !context.active() {
            return Err("Transfer cancelled".to_owned());
        }
        file.write_all(&chunk).await.map_err(|err| err.to_string())?;
        transferred += chunk.len() as u64;
        context.report(&mut reporter, remote_path, transferred, total, 100).await;
    }

    // Ошибка чтения локального файла не должна теряться за `Ok` от канала.
    match reader.await {
        Ok(Ok(())) => {}
        Ok(Err(err)) => return Err(err.to_string()),
        Err(err) => return Err(err.to_string()),
    }

    file.flush().await.map_err(|err| err.to_string())?;
    file.close().await.map_err(|err| err.to_string())?;

    context
        .report(&mut reporter, remote_path, transferred, total, 100)
        .await;
    Ok(transferred)
}

/// Скачивание одного файла с сервера.
pub async fn get_file(
    context: &TransferContext,
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
) -> Result<u64, String> {
    let metadata = sftp
        .metadata(remote_path.to_owned())
        .await
        .map_err(|err| err.to_string())?;
    let total = metadata.size.unwrap_or(0);

    let mut remote = sftp.open(remote_path.to_owned()).await.map_err(|err| err.to_string())?;
    if let Some(parent) = Path::new(local_path).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|err| err.to_string())?;
    }
    let mut local = tokio::fs::File::create(local_path).await.map_err(|err| err.to_string())?;

    let mut transferred = 0u64;
    let mut buffer = vec![0u8; CHUNK];
    let mut reporter = ProgressReporter::new(&context.session_id, &context.transfer_id, "download");

    loop {
        if !context.active() {
            // Частичный файл оставляем: как и в Electron-версии, отмена не
            // удаляет уже скачанное (удаление делает вызывающий код).
            return Err("Transfer cancelled".to_owned());
        }
        let read = remote.read(&mut buffer).await.map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        local.write_all(&buffer[..read]).await.map_err(|err| err.to_string())?;
        transferred += read as u64;
        context.report(&mut reporter, remote_path, transferred, total, 0).await;
    }

    local.flush().await.map_err(|err| err.to_string())?;
    local.sync_all().await.ok();
    drop(local);

    context
        .report(&mut reporter, remote_path, transferred, total, 0)
        .await;
    Ok(transferred)
}

/// Рекурсивная загрузка каталога или файла.
///
/// Возвращает дерево результатов; при отмене — с `cancelled: true` на корне.
pub async fn upload_recursive(
    context: &TransferContext,
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
) -> Result<TransferOutcome, String> {
    let normalized_remote = utils::normalize_remote_path(remote);
    let metadata = tokio::fs::metadata(local).await.map_err(|err| err.to_string())?;

    if metadata.is_dir() {
        sftp.create_dir(normalized_remote.clone())
            .await
            .map_err(|err| err.to_string())?;

        let mut directory = tokio::fs::read_dir(local).await.map_err(|err| err.to_string())?;
        let mut entries: Vec<PathBuf> = Vec::new();
        while let Some(entry) = directory.next_entry().await.map_err(|err| err.to_string())? {
            entries.push(entry.path());
        }
        entries.sort();

        let mut items: Vec<TransferOutcome> = Vec::with_capacity(entries.len());
        for path in entries {
            if !context.active() {
                return Ok(TransferOutcome {
                    remote_path: normalized_remote,
                    is_dir: Some(true),
                    items: Some(items),
                    cancelled: Some(true),
                    ..TransferOutcome::empty()
                });
            }
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            let child_remote = format!("{normalized_remote}/{name}");
            items.push(Box::pin(upload_recursive(context, sftp, &path, &child_remote)).await?);
        }

        return Ok(TransferOutcome {
            remote_path: normalized_remote,
            is_dir: Some(true),
            items: Some(items),
            ..TransferOutcome::empty()
        });
    }

    let filename = local
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();

    match put_file(context, sftp, &local.to_string_lossy(), &normalized_remote).await {
        Ok(size) => Ok(TransferOutcome {
            remote_path: normalized_remote,
            size: Some(size),
            ..TransferOutcome::empty()
        }),
        Err(err) if is_cancellation_like(&err, context) => Ok(TransferOutcome {
            remote_path: normalized_remote,
            cancelled: Some(true),
            ..TransferOutcome::empty()
        }),
        Err(err) => {
            let _ = filename;
            Err(err)
        }
    }
}

/// Рекурсивное скачивание каталога или файла.
pub async fn download_recursive(
    context: &TransferContext,
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
) -> Result<TransferOutcome, String> {
    let normalized_remote = utils::normalize_remote_path(remote);
    let metadata = sftp
        .metadata(normalized_remote.clone())
        .await
        .map_err(|err| err.to_string())?;

    if utils::is_dir(&metadata) {
        tokio::fs::create_dir_all(local).await.map_err(|err| err.to_string())?;

        let entries = sftp
            .read_dir(normalized_remote.clone())
            .await
            .map_err(|err| err.to_string())?;
        let mut names: Vec<String> = entries
            .map(|entry| entry.file_name())
            .filter(|name| name != "." && name != "..")
            .collect();
        names.sort();

        let mut items: Vec<TransferOutcome> = Vec::with_capacity(names.len());
        for name in names {
            if !context.active() {
                break;
            }
            let child_remote = format!("{normalized_remote}/{name}");
            let child_local = local.join(&name);
            match Box::pin(download_recursive(context, sftp, &child_remote, &child_local)).await {
                Ok(outcome) => items.push(outcome),
                Err(err) if is_cancellation_like(&err, context) => {
                    items.push(TransferOutcome {
                        remote_path: child_remote,
                        local_path: Some(child_local.to_string_lossy().to_string()),
                        ..TransferOutcome::empty()
                    });
                    break;
                }
                Err(err) => return Err(err),
            }
        }

        return Ok(TransferOutcome {
            remote_path: normalized_remote,
            local_path: Some(local.to_string_lossy().to_string()),
            is_dir: Some(true),
            items: Some(items),
            ..TransferOutcome::empty()
        });
    }

    let local_path = local.to_string_lossy().to_string();
    match get_file(context, sftp, &normalized_remote, &local_path).await {
        Ok(size) => Ok(TransferOutcome {
            remote_path: normalized_remote,
            local_path: Some(local_path),
            size: Some(size),
            ..TransferOutcome::empty()
        }),
        Err(err) if is_cancellation_like(&err, context) => Ok(TransferOutcome {
            remote_path: normalized_remote,
            local_path: Some(local_path),
            ..TransferOutcome::empty()
        }),
        Err(err) => Err(err),
    }
}

impl TransferOutcome {
    pub fn empty() -> Self {
        TransferOutcome {
            remote_path: String::new(),
            local_path: None,
            is_dir: None,
            items: None,
            cancelled: None,
            size: None,
        }
    }
}

/// Отмена или «канал закрылся сервером» — обе ситуации не считаются ошибкой.
///
/// Сервер может закрыть канал при разрыве связи; Electron-версия так же
/// трактовала `Channel closed` / `destroyed` как отмену, чтобы не показывать
/// пользователю ошибку вместо понятного статуса.
fn is_cancellation_like(error: &str, context: &TransferContext) -> bool {
    if !context.active() {
        return true;
    }
    error.contains("Transfer cancelled")
        || error.contains("No response from server")
        || error.contains("Channel closed")
        || error.contains("destroyed")
}

/// Скачивает файл во временный каталог и следит за его изменениями.
///
/// Каталог вида `yash_<ts>` совпадает с Electron-версией, поэтому очистка
/// осиротевших каталогов старше суток работает одинаково.
pub async fn download_and_watch(
    context: &TransferContext,
    sftp: &SftpSession,
    remote_path: &str,
    filename: &str,
) -> Result<PathBuf, String> {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("yash_{millis}"));
    tokio::fs::create_dir_all(&dir).await.map_err(|err| err.to_string())?;
    let local_path = dir.join(filename);

    get_file(context, sftp, remote_path, &local_path.to_string_lossy()).await?;

    spawn_file_watch(
        context.app.clone(),
        context.session_id.clone(),
        local_path.clone(),
        remote_path.to_owned(),
        filename.to_owned(),
    );
    Ok(local_path)
}

/// Следит за локальным файлом и сообщает об изменениях с дебаунсом 500 мс.
///
/// Наблюдение сделано опросом метаданных (размер + время изменения) раз в
/// 500 мс, а не подпиской на события ФС: это единственный вариант без
/// платформенных зависимостей, а потеря события здесь не ломает сценарий —
/// следующая загрузка всё равно увидит актуальное содержимое. Период совпадает
/// с дебаунсом `fs.watch` в Electron-версии, поэтому нагрузка на UI и задержка
/// уведомления остаются прежними.
fn spawn_file_watch(
    app: AppHandle,
    session_id: String,
    local_path: PathBuf,
    remote_path: String,
    filename: String,
) {
    use serde::Serialize;
    use tauri::Emitter as _;

    #[derive(Clone, Serialize)]
    struct FileChanged {
        #[serde(rename = "localPath")]
        local_path: String,
        #[serde(rename = "remotePath")]
        remote_path: String,
        filename: String,
    }

    tauri::async_runtime::spawn(async move {
        let local_string = local_path.to_string_lossy().to_string();
        let mut previous = file_fingerprint(&local_path);

        loop {
            tokio::time::sleep(WATCH_INTERVAL).await;

            // Файл мог удалить редактор: ждём появления, сохраняя последнее
            // известное состояние, иначе получим лавину «изменений».
            let Some(current) = file_fingerprint(&local_path) else { continue };
            if Some(current) == previous {
                continue;
            }
            // Второй опрос подряд: отсекает «изменение» в момент сохранения
            // (редактор часто пишет файл в два прохода).
            tokio::time::sleep(WATCH_INTERVAL).await;
            let Some(stable) = file_fingerprint(&local_path) else { continue };
            if Some(stable) != previous {
                previous = Some(stable);
                continue;
            }
            previous = Some(stable);

            let _ = app.emit(
                &format!("sftp-file-changed-{session_id}"),
                FileChanged {
                    local_path: local_string.clone(),
                    remote_path: remote_path.clone(),
                    filename: filename.clone(),
                },
            );
        }
    });
}

/// Период опроса файла (совпадает с дебаунсом из Electron-версии).
const WATCH_INTERVAL: Duration = Duration::from_millis(500);

/// Отпечаток файла: размер + время изменения в миллисекундах.
fn file_fingerprint(path: &Path) -> Option<(u64, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((metadata.len(), modified))
}
