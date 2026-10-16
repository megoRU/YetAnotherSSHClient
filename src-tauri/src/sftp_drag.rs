//! Virtual SFTP files dragged out to Windows. Explorer reads each remote file
//! from a stream after the drop, so network I/O never blocks the webview thread.

use serde::Deserialize;
use crate::commands_sftp::SftpDownloadMultipleFile;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDragOutPayload {
    pub id: String,
    pub files: Vec<SftpDownloadMultipleFile>,
    pub icon: String,
}

#[cfg(windows)]
mod windows_drag {
    use std::collections::BTreeMap;
    use std::io::{Error, ErrorKind, Read};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
    use std::time::{Duration, Instant};

    use russh_sftp::client::SftpSession;
    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager, State};
    use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
    use tokio::runtime::Handle;
    use tokio::sync::oneshot;

    use crate::commands_sftp::SftpDownloadMultipleFile;
    use crate::error::{AppError, AppResult};
    use crate::sftp::utils;
    use crate::state::AppState;

    use yassh_dragout::{Ended, Item, Outcome, Source};

    const READ_AHEAD: usize = 8;
    const PIPE_CAPACITY: usize = 1024 * 1024;
    const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
    const MAX_DIRECTORY_DEPTH: usize = 128;

    use super::SftpDragOutPayload;

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TransferEvent {
        id: String,
        filename: String,
        remote_path: String,
        #[serde(rename = "type")]
        kind: &'static str,
        status: &'static str,
        size: u64,
        is_dir: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        notify_success: Option<bool>,
    }

    #[derive(Clone, Serialize)]
    struct ProgressEvent {
        id: String,
        #[serde(rename = "remotePath")]
        remote_path: String,
        progress: u32,
        transferred: u64,
        total: u64,
        #[serde(rename = "type")]
        kind: &'static str,
    }

    struct Root {
        request: SftpDownloadMultipleFile,
        progress: Arc<RootProgress>,
    }

    struct RootProgress {
        app: AppHandle,
        session_id: String,
        transfer_id: String,
        filename: String,
        remote_path: String,
        is_dir: Option<bool>,
        notify_success: bool,
        total: AtomicU64,
        transferred: AtomicU64,
        last_emit: Mutex<Instant>,
        start_sent: AtomicBool,
    }

    impl RootProgress {
        fn send(&self, progress: u32) {
            let _ = self.app.emit(
                &format!("sftp-progress-{}", self.session_id),
                ProgressEvent {
                    id: self.transfer_id.clone(),
                    remote_path: self.remote_path.clone(),
                    progress,
                    transferred: self.transferred.load(Ordering::Relaxed),
                    total: self.total.load(Ordering::Relaxed),
                    kind: "download",
                },
            );
        }

        fn start(&self) {
            if self.start_sent.swap(true, Ordering::AcqRel) {
                return;
            }
            let total = self.total.load(Ordering::Relaxed);
            let _ = self.app.emit(
                &format!("sftp-transfer-start-{}", self.session_id),
                TransferEvent {
                    id: self.transfer_id.clone(),
                    filename: self.filename.clone(),
                    remote_path: self.remote_path.clone(),
                    kind: "download",
                    status: "active",
                    size: total,
                    is_dir: self.is_dir,
                    error: None,
                    notify_success: None,
                },
            );
            self.send(0);
        }

        fn add_bytes(&self, bytes: usize) {
            let total = self.total.load(Ordering::Relaxed);
            let transferred = self
                .transferred
                .fetch_add(bytes as u64, Ordering::Relaxed)
                .saturating_add(bytes as u64)
                .min(total);
            if let Ok(mut last_emit) = self.last_emit.lock() {
                if last_emit.elapsed() >= PROGRESS_INTERVAL {
                    *last_emit = Instant::now();
                    drop(last_emit);
                    self.send(progress_percent(transferred, total));
                }
            }
        }

        fn finish(&self, status: &'static str, error: Option<String>) {
            if status == "success" {
                self.transferred
                    .store(self.total.load(Ordering::Relaxed), Ordering::Relaxed);
                self.send(100);
            }
            let _ = self.app.emit(
                &format!("sftp-transfer-start-{}", self.session_id),
                TransferEvent {
                    id: self.transfer_id.clone(),
                    filename: self.filename.clone(),
                    remote_path: self.remote_path.clone(),
                    kind: "download",
                    status,
                    size: self.total.load(Ordering::Relaxed),
                    is_dir: self.is_dir,
                    error,
                    notify_success: (status == "success").then_some(self.notify_success),
                },
            );
        }
    }

    fn progress_percent(transferred: u64, total: u64) -> u32 {
        if total == 0 {
            0
        } else {
            ((transferred as f64 / total as f64) * 100.0).round().min(99.0) as u32
        }
    }

    struct PlannedFile {
        item: Item,
        remote_path: String,
        root_index: usize,
    }

    struct Pipe {
        reader: DuplexStream,
        result: oneshot::Receiver<Result<(), String>>,
    }

    #[derive(Default)]
    struct Pipes {
        ahead: BTreeMap<usize, Pipe>,
        next: usize,
    }

    struct SftpSource {
        runtime: Handle,
        app: AppHandle,
        sftp: Arc<SftpSession>,
        roots: Vec<Root>,
        plan: Mutex<Option<oneshot::Receiver<Result<Vec<PlannedFile>, String>>>>,
        planned: OnceLock<Vec<PlannedFile>>,
        started: AtomicBool,
        pipes: Mutex<Pipes>,
        cancelled: Arc<AtomicBool>,
    }

    impl SftpSource {
        fn start_read(&self, file: &PlannedFile) -> Pipe {
            let (mut writer, reader) = tokio::io::duplex(PIPE_CAPACITY);
            let (result_tx, result) = oneshot::channel();
            let remote_path = file.remote_path.clone();
            let sftp = Arc::clone(&self.sftp);
            let cancelled = Arc::clone(&self.cancelled);
            self.runtime.spawn(async move {
                let read_result = async {
                    let mut remote = sftp
                        .open(remote_path)
                        .await
                        .map_err(|error| error.to_string())?;
                    let mut buffer = vec![0u8; 64 * 1024];
                    loop {
                        if cancelled.load(Ordering::Acquire) {
                            return Err("SFTP drag cancelled".to_owned());
                        }
                        let count = remote.read(&mut buffer).await.map_err(|error| error.to_string())?;
                        if count == 0 {
                            return Ok(());
                        }
                        writer.write_all(&buffer[..count]).await.map_err(|error| error.to_string())?;
                    }
                }
                .await;
                drop(writer);
                let _ = result_tx.send(read_result);
            });
            Pipe { reader, result }
        }

        fn start_read_ahead(&self, index: usize) -> Pipe {
            let planned = self.planned.get().map(Vec::as_slice).unwrap_or_default();
            self.start_read(&planned[index])
        }
    }

    impl Source for SftpSource {
        fn items(&self) -> Result<Vec<Item>, String> {
            let receiver = lock(&self.plan)
                .take()
                .ok_or_else(|| "SFTP drag listing was already read".to_owned())?;
            let planned = self
                .runtime
                .block_on(receiver)
                .map_err(|_| "SFTP drag listing was cancelled".to_owned())??;
            let mut totals = vec![0u64; self.roots.len()];
            for file in &planned {
                totals[file.root_index] = totals[file.root_index].saturating_add(file.item.size);
            }
            for (root, total) in self.roots.iter().zip(totals) {
                root.progress.total.store(total, Ordering::Relaxed);
            }
            let items = planned.iter().map(|file| file.item.clone()).collect();
            let _ = self.planned.set(planned);
            if self.started.load(Ordering::Acquire) {
                for root in &self.roots {
                    root.progress.start();
                }
            }
            Ok(items)
        }

        fn open(&self, index: usize) -> std::io::Result<Box<dyn Read + Send>> {
            let planned = self.planned.get().map(Vec::as_slice).unwrap_or_default();
            let file = planned
                .get(index)
                .filter(|file| !file.item.folder)
                .ok_or_else(|| Error::from(ErrorKind::NotFound))?;
            let root_progress = Arc::clone(&self.roots[file.root_index].progress);
            let pipe = {
                let mut pipes = lock(&self.pipes);
                let pipe = pipes.ahead.remove(&index).unwrap_or_else(|| self.start_read(file));
                pipes.next = pipes.next.max(index + 1);
                while pipes.ahead.len() < READ_AHEAD && pipes.next < planned.len() {
                    let next = pipes.next;
                    pipes.next += 1;
                    if !planned[next].item.folder {
                        let ahead = self.start_read_ahead(next);
                        pipes.ahead.insert(next, ahead);
                    }
                }
                pipe
            };
            Ok(Box::new(PipeReader {
                pipe,
                runtime: self.runtime.clone(),
                progress: root_progress,
                ended: false,
            }))
        }

        fn started(&self) {
            self.started.store(true, Ordering::Release);
            if self.planned.get().is_some() {
                for root in &self.roots {
                    root.progress.start();
                }
            }
        }

        fn finished(&self, ended: Ended) {
            self.cancelled.store(true, Ordering::Release);
            lock(&self.pipes).ahead.clear();
            let (status, error) = match ended {
                Ended::Done => ("success", None),
                Ended::Cancelled => ("cancelled", None),
                Ended::Failed(error) => ("error", Some(error)),
            };
            for root in &self.roots {
                root.progress.finish(status, error.clone());
            }
            let app = self.app.clone();
            let transfer_ids = self.roots.iter().map(|root| root.request.transfer_id.clone()).collect::<Vec<_>>();
            let sftp = Arc::clone(&self.sftp);
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app.try_state::<AppState>() {
                    for transfer_id in transfer_ids {
                        state.sftp.unregister_transfer(&transfer_id).await;
                    }
                }
                let _ = sftp.close().await;
            });
        }
    }

    struct PipeReader {
        pipe: Pipe,
        runtime: Handle,
        progress: Arc<RootProgress>,
        ended: bool,
    }

    impl Read for PipeReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if buffer.is_empty() || self.ended {
                return Ok(0);
            }
            let count = self.runtime.block_on(self.pipe.reader.read(buffer))?;
            if count > 0 {
                self.progress.add_bytes(count);
                return Ok(count);
            }
            self.ended = true;
            match self.runtime.block_on(&mut self.pipe.result) {
                Ok(Ok(())) => Ok(0),
                Ok(Err(error)) => Err(Error::new(ErrorKind::ConnectionAborted, error)),
                Err(_) => Err(Error::new(ErrorKind::ConnectionAborted, "SFTP read task stopped")),
            }
        }
    }

    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub async fn sftp_drag_out(
        window: tauri::WebviewWindow,
        state: State<'_, AppState>,
        payload: SftpDragOutPayload,
    ) -> AppResult<bool> {
        if payload.files.is_empty() {
            return Ok(false);
        }
        let icon = payload
            .icon
            .strip_prefix("data:image/png;base64,")
            .ok_or_else(|| AppError::Key("errors.invalidConfigFormat"))?;
        use base64::Engine as _;
        let icon = base64::engine::general_purpose::STANDARD
            .decode(icon)
            .map_err(|error| AppError::Localized(error.to_string()))?;
        for request in &payload.files {
            utils::validate_local_filename(&request.filename).map_err(AppError::Localized)?;
        }

        let sftp = state
            .sftp
            .transfer_channel(&payload.id)
            .await
            .map_err(AppError::Localized)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut roots = Vec::with_capacity(payload.files.len());
        for request in payload.files {
            state
                .sftp
                .register_transfer(&payload.id, &request.transfer_id, Arc::clone(&sftp), None, false)
                .await;
            roots.push(Root {
                progress: Arc::new(RootProgress {
                    app: window.app_handle().clone(),
                    session_id: payload.id.clone(),
                    transfer_id: request.transfer_id.clone(),
                    filename: request.filename.clone(),
                    remote_path: request.remote_path.clone(),
                    is_dir: request.is_dir,
                    notify_success: roots.is_empty(),
                    total: AtomicU64::new(0),
                    transferred: AtomicU64::new(0),
                    last_emit: Mutex::new(Instant::now()),
                    start_sent: AtomicBool::new(false),
                }),
                request,
            });
        }

        let (plan_tx, plan_rx) = oneshot::channel();
        let plan_sftp = Arc::clone(&sftp);
        let plan_roots = roots.iter().map(|root| root.request.clone()).collect::<Vec<_>>();
        let plan_cancel = Arc::clone(&cancelled);
        tauri::async_runtime::spawn(async move {
            let _ = plan_tx.send(plan_items(&plan_sftp, &plan_roots, &plan_cancel).await);
        });
        let transfer_ids = roots
            .iter()
            .map(|root| root.request.transfer_id.clone())
            .collect::<Vec<_>>();

        let source = Arc::new(SftpSource {
            runtime: Handle::current(),
            app: window.app_handle().clone(),
            sftp: Arc::clone(&sftp),
            roots,
            plan: Mutex::new(Some(plan_rx)),
            planned: OnceLock::new(),
            started: AtomicBool::new(false),
            pipes: Mutex::new(Pipes::default()),
            cancelled: Arc::clone(&cancelled),
        });
        let source: Arc<dyn Source> = source;
        let hwnd = window.hwnd().map_err(|error| AppError::Localized(error.to_string()))?.0 as isize;
        let (outcome_tx, outcome_rx) = oneshot::channel();
        let drag_result = window.run_on_main_thread(move || {
            let outcome = yassh_dragout::drag(hwnd, source, &icon).map_err(|error| error.message());
            let _ = outcome_tx.send(outcome);
        });
        let outcome = match drag_result {
            Ok(()) => outcome_rx
                .await
                .map_err(|_| AppError::Localized("SFTP drag was interrupted".to_owned()))
                .and_then(|result| result.map_err(AppError::Localized)),
            Err(error) => Err(AppError::Localized(error.to_string())),
        };
        if !matches!(outcome, Ok(Outcome::Dropped)) {
            cancelled.store(true, Ordering::Release);
            let _ = sftp.close().await;
            for transfer_id in transfer_ids {
                state.sftp.unregister_transfer(&transfer_id).await;
            }
        }
        outcome.map(|outcome| outcome == Outcome::Dropped)
    }

    async fn plan_items(
        sftp: &SftpSession,
        roots: &[SftpDownloadMultipleFile],
        cancelled: &AtomicBool,
    ) -> Result<Vec<PlannedFile>, String> {
        let mut files = Vec::new();
        for (root_index, root) in roots.iter().enumerate() {
            let filename = utils::validate_local_filename(&root.filename)?;
            plan_path(
                sftp,
                &root.remote_path,
                filename,
                root_index,
                0,
                cancelled,
                &mut files,
            )
            .await?;
        }
        Ok(files)
    }

    #[allow(clippy::too_many_arguments)]
    fn plan_path<'a>(
        sftp: &'a SftpSession,
        remote_path: &'a str,
        relative_path: &'a str,
        root_index: usize,
        depth: usize,
        cancelled: &'a AtomicBool,
        files: &'a mut Vec<PlannedFile>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            if cancelled.load(Ordering::Acquire) {
                return Err("SFTP drag cancelled".to_owned());
            }
            if depth > MAX_DIRECTORY_DEPTH {
                return Err("Remote folder nesting is too deep to drag".to_owned());
            }
            let remote_path = utils::normalize_remote_path(remote_path);
            let metadata = sftp.metadata(remote_path.clone()).await.map_err(|error| error.to_string())?;
            let is_dir = utils::is_dir(&metadata);
            files.push(PlannedFile {
                item: Item {
                    path: relative_path.to_owned(),
                    folder: is_dir,
                    size: if is_dir { 0 } else { metadata.size.unwrap_or(0) },
                    modified: metadata.mtime.map(u64::from),
                },
                remote_path: remote_path.clone(),
                root_index,
            });
            if !is_dir {
                return Ok(());
            }
            let mut names = sftp
                .read_dir(remote_path.clone())
                .await
                .map_err(|error| error.to_string())?
                .map(|entry| entry.file_name())
                .filter(|name| name != "." && name != "..")
                .collect::<Vec<_>>();
            names.sort();
            for name in names {
                let name = utils::validate_local_filename(&name)?.to_owned();
                let child_remote = utils::normalize_remote_path(&format!("{remote_path}/{name}"));
                let child_relative = format!("{relative_path}\\{name}");
                plan_path(
                    sftp,
                    &child_remote,
                    &child_relative,
                    root_index,
                    depth + 1,
                    cancelled,
                    files,
                )
                .await?;
            }
            Ok(())
        })
    }
}

#[cfg(windows)]
#[tauri::command]
pub async fn sftp_drag_out(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::state::AppState>,
    payload: SftpDragOutPayload,
) -> crate::error::AppResult<bool> {
    windows_drag::sftp_drag_out(window, state, payload).await
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn sftp_drag_out(
    _window: tauri::WebviewWindow,
    _state: tauri::State<'_, crate::state::AppState>,
    _payload: SftpDragOutPayload,
) -> crate::error::AppResult<bool> {
    Err(crate::error::AppError::Key("errors.invalidConfigFormat"))
}
