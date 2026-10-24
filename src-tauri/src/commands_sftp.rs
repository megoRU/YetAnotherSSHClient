//! SFTP-команды — часть IPC-контракта, раньше обслуживавшаяся
//! `sftpManager` в `electron/src/ipc-handlers.ts`.
//!
//! Вынесены отдельным модулем, чтобы `commands.rs` оставался читаемым: здесь
//! сосредоточены операции с файлами, трансферы и диалоги выбора пути.

use std::path::{Path, PathBuf};
use std::sync::Arc;

#[cfg(windows)]
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
#[cfg(not(windows))]
use tauri_plugin_opener::OpenerExt;

use crate::config::{self, SshConfig};
use crate::error::{AppError, AppResult};
use crate::paths;
use crate::sftp::{self, utils};
use crate::state::AppState;

// ── Подключение ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConnectPayload {
    pub id: String,
    pub config: SshConfig,
}

#[tauri::command]
pub async fn sftp_connect(app: AppHandle, payload: SftpConnectPayload) -> AppResult<()> {
    // Electron использовал ipcMain.on: IPC завершается сразу, а статус
    // подключения приходит отдельными событиями. Не держим invoke callback
    // живым на время SSH handshake / открытия SFTP-подсистемы.
    tauri::async_runtime::spawn(async move {
        if let Some(state) = app.try_state::<AppState>() {
            // Отпечаток ключа хоста берётся из main-процесса: снимок рендерера
            // его не содержит (см. `commands::config_for_connect`).
            let config = config::with_stored_fingerprint(&payload.config);
            state.sftp.connect(&app, &payload.id, config).await;
        }
    });
    Ok(())
}

// ── Файловые операции ────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpPathRequest {
    pub id: String,
    pub path: String,
}

/// Сессионный канал вкладки; `Ok(None)` — вкладка не подключена.
async fn channel(state: &State<'_, AppState>, id: &str) -> AppResult<Option<Arc<russh_sftp::client::SftpSession>>> {
    Ok(state.sftp.session(id).await.map(|entry| entry.sftp))
}

#[tauri::command]
pub async fn sftp_realpath(state: State<'_, AppState>, payload: SftpPathRequest) -> AppResult<String> {
    let Some(sftp) = channel(&state, &payload.id).await? else { return Ok("/".to_owned()) };
    sftp::files::realpath(&sftp, &payload.path).await.map_err(AppError::Localized)
}

#[tauri::command]
pub async fn sftp_readdir(
    state: State<'_, AppState>,
    payload: SftpPathRequest,
) -> AppResult<Option<Vec<sftp::files::FileEntry>>> {
    let Some(sftp) = channel(&state, &payload.id).await? else { return Ok(None) };
    sftp::files::readdir(&sftp, &payload.path).await.map(Some).map_err(AppError::Localized)
}

#[tauri::command]
pub async fn sftp_mkdir(state: State<'_, AppState>, payload: SftpPathRequest) -> AppResult<Option<bool>> {
    let Some(sftp) = channel(&state, &payload.id).await? else { return Ok(None) };
    crate::logger::info("SFTP", &format!("Creating directory: {}", payload.path));
    sftp::files::mkdir(&sftp, &payload.path).await.map(|()| Some(true)).map_err(AppError::Localized)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpRmRequest {
    pub id: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn sftp_rm(state: State<'_, AppState>, payload: SftpRmRequest) -> AppResult<Option<bool>> {
    let Some(sftp) = channel(&state, &payload.id).await? else { return Ok(None) };
    crate::logger::info(
        "SFTP",
        &format!("Removing {}: {}", if payload.is_dir { "directory" } else { "file" }, payload.path),
    );
    sftp::files::remove(&sftp, &payload.path, payload.is_dir)
        .await
        .map(|()| Some(true))
        .map_err(AppError::Localized)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpRenameRequest {
    pub id: String,
    pub old_path: String,
    pub new_path: String,
}

#[tauri::command]
pub async fn sftp_rename(state: State<'_, AppState>, payload: SftpRenameRequest) -> AppResult<Option<bool>> {
    let Some(sftp) = channel(&state, &payload.id).await? else { return Ok(None) };
    crate::logger::info("SFTP", &format!("Renaming: {} -> {}", payload.old_path, payload.new_path));
    sftp::files::rename(&sftp, &payload.old_path, &payload.new_path)
        .await
        .map(|()| Some(true))
        .map_err(AppError::Localized)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpChmodRequest {
    pub id: String,
    pub path: String,
    /// Режим приходит числом либо строкой с окталами (`"755"`, `"0o755"`).
    #[serde(deserialize_with = "deserialize_mode")]
    pub mode: u32,
}

fn deserialize_mode<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize as _;

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Mode {
        Number(u32),
        Text(String),
    }

    match Mode::deserialize(deserializer)? {
        Mode::Number(value) => Ok(value),
        Mode::Text(text) => {
            let trimmed = text.trim();
            let without_prefix = trimmed.strip_prefix("0o").unwrap_or(trimmed);
            u32::from_str_radix(without_prefix, 8)
                .or_else(|_| trimmed.parse::<u32>())
                .map_err(serde::de::Error::custom)
        }
    }
}

#[tauri::command]
pub async fn sftp_chmod(state: State<'_, AppState>, payload: SftpChmodRequest) -> AppResult<Option<bool>> {
    let Some(sftp) = channel(&state, &payload.id).await? else { return Ok(None) };
    sftp::files::chmod(&sftp, &payload.path, payload.mode)
        .await
        .map(|()| Some(true))
        .map_err(AppError::Localized)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpExtractRequest {
    pub id: String,
    pub remote_path: String,
}

#[tauri::command]
pub async fn sftp_extract(state: State<'_, AppState>, payload: SftpExtractRequest) -> AppResult<bool> {
    let Some(entry) = state.sftp.session(&payload.id).await else {
        return Err(AppError::Key("errors.sshClientNotFound"));
    };
    crate::logger::info("SFTP", &format!("Extracting archive: {}", payload.remote_path));
    sftp::archive::extract(&entry.connection, &payload.remote_path)
        .await
        .map_err(AppError::Localized)
}

// ── Скачивание ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadFileRequest {
    pub id: String,
    pub remote_path: String,
    pub filename: String,
    pub transfer_id: String,
}

/// Результат скачивания (`SftpDownloadResult`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadResult {
    pub remote_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dir: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[tauri::command]
pub async fn sftp_download_file(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpDownloadFileRequest,
    dialog_title: String,
) -> AppResult<Option<SftpDownloadResult>> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Ok(None);
    }

    let Some(local) = app
        .dialog()
        .file()
        .set_file_name(&payload.filename)
        .set_title(&dialog_title)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let local = local.into_path().map_err(|err| AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;

    let channel = state.sftp.transfer_channel(&payload.id).await.map_err(AppError::Localized)?;
    state.sftp.register_transfer(&payload.id, &payload.transfer_id, channel.clone(), None, false).await;
    emit_transfer_start(&app, &payload.id, &payload.transfer_id, &payload.filename, &payload.remote_path, None);

    let outcome = async {
        let metadata = channel.metadata(payload.remote_path.clone()).await.map_err(|err| err.to_string())?;
        let aggregate = if utils::is_dir(&metadata) {
            let total = utils::remote_folder_size(&channel, &payload.remote_path, 0).await;
            Some(sftp::progress::AggregateState::new(&payload.remote_path, total))
        } else {
            None
        };
        let context = transfer_context(
            &app,
            &state,
            &payload.id,
            &payload.transfer_id,
            sftp::Direction::Download,
            aggregate,
            None,
        );
        sftp::transfer::download_recursive(&context, &channel, &payload.remote_path, &local).await
    }.await;
    state.sftp.unregister_transfer(&payload.transfer_id).await;
    let outcome = outcome.map_err(AppError::Localized)?;

    Ok(Some(SftpDownloadResult {
        remote_path: outcome.remote_path,
        local_path: outcome.local_path,
        is_dir: outcome.is_dir,
        size: outcome.size,
    }))
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadMultipleFile {
    pub remote_path: String,
    pub filename: String,
    pub transfer_id: String,
    pub is_dir: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadMultipleRequest {
    pub id: String,
    pub files: Vec<SftpDownloadMultipleFile>,
}

#[tauri::command]
pub async fn sftp_download_multiple_files(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpDownloadMultipleRequest,
) -> AppResult<Option<Vec<Option<SftpDownloadResult>>>> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Ok(None);
    }

    let Some(directory) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = directory.into_path().map_err(|err| AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;

    let mut results: Vec<Option<SftpDownloadResult>> = Vec::with_capacity(payload.files.len());
    for file in payload.files {
        if state.sftp.session(&payload.id).await.is_none() {
            results.push(None);
            continue;
        }

        let filename = utils::validate_local_filename(&file.filename).map_err(AppError::Localized)?;
        let channel = state.sftp.transfer_channel(&payload.id).await.map_err(AppError::Localized)?;
        state.sftp.register_transfer(&payload.id, &file.transfer_id, channel.clone(), None, false).await;
        emit_transfer_start(&app, &payload.id, &file.transfer_id, &file.filename, &file.remote_path, file.is_dir);

        let aggregate = if file.is_dir == Some(true) {
            let total = utils::remote_folder_size(&channel, &file.remote_path, 0).await;
            Some(sftp::progress::AggregateState::new(&file.remote_path, total))
        } else {
            None
        };
        let context = transfer_context(
            &app,
            &state,
            &payload.id,
            &file.transfer_id,
            sftp::Direction::Download,
            aggregate,
            None,
        );

        let local = directory.join(filename);
        let outcome = sftp::transfer::download_recursive(&context, &channel, &file.remote_path, &local).await;
        state.sftp.unregister_transfer(&file.transfer_id).await;
        let outcome = outcome.map_err(AppError::Localized)?;

        results.push(Some(SftpDownloadResult {
            remote_path: outcome.remote_path,
            local_path: outcome.local_path,
            is_dir: outcome.is_dir,
            size: outcome.size,
        }));
    }

    Ok(Some(results))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadForDragResult {
    pub paths: Vec<String>,
    pub icons: Vec<Option<String>>,
    pub icon: Option<String>,
    pub temp_directory: String,
}

/// Готовит только временные пути и системные иконки для будущего drag-out.
#[tauri::command]
pub async fn sftp_prepare_drag(
    state: State<'_, AppState>,
    payload: SftpDownloadMultipleRequest,
) -> AppResult<Option<SftpDownloadForDragResult>> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Ok(None);
    }
    let temp_directory = create_drag_temp_directory().await.map_err(|err| {
        AppError::with_source("errors.invalidConfigFormat", err.to_string())
    })?;
    let mut paths = Vec::with_capacity(payload.files.len());
    for file in payload.files {
        let filename = match utils::validate_local_filename(&file.filename) {
            Ok(filename) => filename,
            Err(err) => {
                let _ = tokio::fs::remove_dir_all(&temp_directory).await;
                return Err(AppError::Localized(err));
            }
        };
        let local_path = temp_directory.join(filename);
        let create_result = if file.is_dir == Some(true) {
            tokio::fs::create_dir(&local_path).await
        } else {
            tokio::fs::File::create(&local_path).await.map(|_| ())
        };
        if let Err(err) = create_result {
            let _ = tokio::fs::remove_dir_all(&temp_directory).await;
            return Err(AppError::Localized(err.to_string()));
        }
        paths.push(local_path.to_string_lossy().into_owned());
    }

    let icons = paths
        .iter()
        .map(|path| crate::window::system_file_icon(path))
        .collect::<Vec<_>>();
    let icon = icons.first().cloned().flatten();

    Ok(Some(SftpDownloadForDragResult {
        paths,
        icons,
        icon,
        temp_directory: temp_directory.to_string_lossy().into_owned(),
    }))
}

/// Совместимый путь для систем, где отложенная передача через OLE не доступна.
#[tauri::command]
pub async fn sftp_download_for_drag(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpDownloadMultipleRequest,
) -> AppResult<Option<SftpDownloadForDragResult>> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Ok(None);
    }
    let temp_directory = create_drag_temp_directory().await.map_err(|error| AppError::Localized(error.to_string()))?;
    if let Err(error) = download_drag_files(&app, &state, &payload.id, &payload.files, &temp_directory).await {
        let _ = tokio::fs::remove_dir_all(&temp_directory).await;
        return Err(AppError::Localized(error));
    }
    let paths = payload.files.iter().map(|file| {
        utils::validate_local_filename(&file.filename)
            .map(|filename| temp_directory.join(filename).to_string_lossy().into_owned())
            .map_err(AppError::Localized)
    }).collect::<AppResult<Vec<_>>>()?;
    let icons = paths.iter().map(|path| crate::window::system_file_icon(path)).collect::<Vec<_>>();
    let icon = icons.first().cloned().flatten();
    Ok(Some(SftpDownloadForDragResult {
        paths,
        icons,
        icon,
        temp_directory: temp_directory.to_string_lossy().into_owned(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpStartDragPayload {
    pub id: String,
    pub files: Vec<SftpDownloadMultipleFile>,
    pub paths: Vec<String>,
    pub temp_directory: String,
    pub icon: String,
}

/// Запускает системный drag сразу, а скачивание выполняет после отпускания
/// кнопки мыши, пока оболочка ожидает готовые файлы по переданным путям.
#[tauri::command]
pub async fn sftp_start_drag(app: AppHandle, payload: SftpStartDragPayload) -> AppResult<()> {
    #[cfg(not(windows))]
    {
        let _ = (app, payload);
        return Err(AppError::Localized("Deferred SFTP drag is available on Windows only".to_owned()));
    }
    #[cfg(windows)]
    {
        use base64::Engine as _;

        if payload.paths.len() != payload.files.len() || payload.paths.is_empty() {
            return Err(AppError::Localized("Invalid SFTP drag payload".to_owned()));
        }
        let temporary_root = validate_drag_temp_directory(&payload.temp_directory).await?;
        let mut paths = Vec::with_capacity(payload.paths.len());
        for (path, file) in payload.paths.iter().zip(&payload.files) {
            let candidate = PathBuf::from(path).canonicalize().map_err(|error| AppError::Localized(error.to_string()))?;
            if candidate.parent() != Some(temporary_root.as_path())
                || candidate.file_name().and_then(|name| name.to_str()) != Some(file.filename.as_str())
            {
                return Err(AppError::Localized("Invalid SFTP drag path".to_owned()));
            }
            paths.push(candidate);
        }
        let icon_data = payload.icon.strip_prefix("data:image/png;base64,")
            .ok_or_else(|| AppError::Localized("Invalid drag preview image".to_owned()))?;
        let icon = base64::engine::general_purpose::STANDARD
            .decode(icon_data)
            .map_err(|error| AppError::Localized(error.to_string()))?;
        let window = app.get_webview_window(crate::window::MAIN_WINDOW)
            .ok_or_else(|| AppError::Localized("Main window is unavailable".to_owned()))?;

        let drag_app = app.clone();
        let drag_id = payload.id;
        let drag_files = payload.files;
        let drag_root = temporary_root.clone();
        let transfer_error = Arc::new(Mutex::new(None::<String>));
        let hook_error = Arc::clone(&transfer_error);
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let result = drag::start_drag_with_release_hook(
                &window,
                drag::DragItem::Files(paths),
                drag::Image::Raw(icon),
                |_, _| {},
                drag::Options { mode: drag::DragMode::Copy, ..Default::default() },
                move || {
                    let (transfer_tx, transfer_rx) = std::sync::mpsc::channel();
                    let transfer_app = drag_app.clone();
                    let transfer_id = drag_id.clone();
                    let transfer_files = drag_files.clone();
                    let transfer_root = drag_root.clone();
                    let worker = std::thread::Builder::new()
                        .name("sftp-drag-download".to_owned())
                        .spawn(move || {
                            let result = match transfer_app.try_state::<AppState>() {
                                Some(state) => tauri::async_runtime::block_on(download_drag_files(
                                    &transfer_app,
                                    &state,
                                    &transfer_id,
                                    &transfer_files,
                                    &transfer_root,
                                )),
                                None => Err("SFTP state is unavailable".to_owned()),
                            };
                            let _ = transfer_tx.send(result);
                        });
                    let result = match worker {
                        Ok(_worker) => wait_for_drag_download(transfer_rx),
                        Err(error) => Err(error.to_string()),
                    };
                    match result {
                        Ok(()) => true,
                        Err(error) => {
                            *hook_error.lock() = Some(error);
                            false
                        }
                    }
                },
            ).map_err(|error| error.to_string());
            let _ = result_tx.send(result);
        }).map_err(|error| AppError::Localized(error.to_string()))?;

        let drag_result = result_rx.recv().map_err(|error| AppError::Localized(error.to_string()))?;
        let _ = tokio::fs::remove_dir_all(&temporary_root).await;
        drag_result.map_err(AppError::Localized)?;
        if let Some(error) = transfer_error.lock().take() {
            return Err(AppError::Localized(error));
        }
        Ok(())
    }
}

#[cfg(windows)]
fn wait_for_drag_download(receiver: std::sync::mpsc::Receiver<Result<(), String>>) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };

    loop {
        match receiver.try_recv() {
            Ok(result) => return result,
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                return Err("SFTP drag download worker stopped unexpectedly".to_owned());
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
        }

        let mut message = MSG::default();
        while unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
            unsafe {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(8));
    }
}

async fn download_drag_files(
    app: &AppHandle,
    state: &State<'_, AppState>,
    session_id: &str,
    files: &[SftpDownloadMultipleFile],
    temp_directory: &Path,
) -> Result<(), String> {
    if state.sftp.session(session_id).await.is_none() {
        return Err("SFTP connection is no longer available".to_owned());
    }
    for file in files {
        let filename = utils::validate_local_filename(&file.filename)?;
        let channel = state.sftp.transfer_channel(session_id).await?;
        state.sftp.register_transfer(session_id, &file.transfer_id, channel.clone(), None, false).await;
        emit_transfer_start(app, session_id, &file.transfer_id, &file.filename, &file.remote_path, file.is_dir);

        let aggregate = if file.is_dir == Some(true) {
            let total = utils::remote_folder_size(&channel, &file.remote_path, 0).await;
            Some(sftp::progress::AggregateState::new(&file.remote_path, total))
        } else {
            None
        };
        let context = transfer_context(
            app,
            state,
            session_id,
            &file.transfer_id,
            sftp::Direction::Download,
            aggregate,
            None,
        );
        let local_path = temp_directory.join(filename);
        let outcome = sftp::transfer::download_recursive(&context, &channel, &file.remote_path, &local_path).await;
        state.sftp.unregister_transfer(&file.transfer_id).await;
        outcome.map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
async fn validate_drag_temp_directory(temp_directory: &str) -> AppResult<PathBuf> {
    let temporary_root = std::env::temp_dir().canonicalize().map_err(|error| AppError::Localized(error.to_string()))?;
    let candidate = PathBuf::from(temp_directory).canonicalize().map_err(|error| AppError::Localized(error.to_string()))?;
    let is_owned_temp = candidate.parent() == Some(temporary_root.as_path())
        && candidate.file_name().is_some_and(|name| name.to_string_lossy().starts_with("yash_drag_"));
    if !is_owned_temp || !candidate.is_dir() {
        return Err(AppError::Localized("Invalid SFTP drag temporary directory".to_owned()));
    }
    Ok(candidate)
}

#[tauri::command]
pub async fn sftp_cleanup_drag_files(temp_directory: String) -> AppResult<bool> {
    let temporary_root = std::env::temp_dir().canonicalize().map_err(|err| {
        AppError::with_source("errors.invalidConfigFormat", err.to_string())
    })?;
    let candidate = PathBuf::from(temp_directory);
    let Ok(candidate) = candidate.canonicalize() else { return Ok(false) };
    let is_owned_temp = candidate.parent() == Some(temporary_root.as_path())
        && candidate.file_name().is_some_and(|name| name.to_string_lossy().starts_with("yash_drag_"));
    if !is_owned_temp || !candidate.is_dir() {
        return Ok(false);
    }
    tokio::fs::remove_dir_all(candidate)
        .await
        .map(|()| true)
        .map_err(|err| AppError::with_source("errors.invalidConfigFormat", err.to_string()))
}

async fn create_drag_temp_directory() -> std::io::Result<PathBuf> {
    let root = std::env::temp_dir();
    for attempt in 0..10_u8 {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = root.join(format!("yash_drag_{}_{}_{}", std::process::id(), timestamp, attempt));
        match tokio::fs::create_dir(&directory).await {
            Ok(()) => return Ok(directory),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "Could not create a unique temporary directory for drag-and-drop",
    ))
}

// ── Загрузка ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpUploadFromPath {
    pub local_path: String,
    pub transfer_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpUploadFilesFromPathsRequest {
    pub id: String,
    pub remote_dir: String,
    pub transfers: Vec<SftpUploadFromPath>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub delete_remote_partial_on_cancel: bool,
}

#[tauri::command]
pub async fn sftp_upload_files_from_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpUploadFilesFromPathsRequest,
) -> AppResult<Option<Vec<sftp::TransferOutcome>>> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Ok(None);
    }
    crate::logger::info(
        "SFTP",
        &format!("Uploading {} items to: {} (ID: {})", payload.transfers.len(), payload.remote_dir, payload.id),
    );

    let upload_group = if let Some(group_id) = payload.group_id.as_deref() {
        let Some(session) = state.sftp.session(&payload.id).await else { return Ok(None) };
        Some(state.sftp.register_upload_group(
            group_id,
            &payload.id,
            session.sftp,
            payload.delete_remote_partial_on_cancel,
        ).await)
    } else {
        None
    };

    // Собственный SFTP-канал на всю операцию: отмена одной загрузки не должна
    // затрагивать остальные загрузки той же вкладки.
    let channel = match state.sftp.transfer_channel(&payload.id).await {
        Ok(channel) => channel,
        Err(message) => {
            if let Some(group_id) = payload.group_id.as_deref() {
                state.sftp.unregister_upload_group(group_id).await;
            }
            return Err(AppError::Localized(message));
        }
    };

    let mut results: Vec<sftp::TransferOutcome> = Vec::with_capacity(payload.transfers.len());
    for transfer in payload.transfers {
        if upload_group.as_ref().is_some_and(|group| group.is_cancelled()) {
            break;
        }
        let filename = Path::new(&transfer.local_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let target = utils::normalize_remote_path(&format!("{}/{}", payload.remote_dir, filename));
        let is_directory = tokio::fs::metadata(&transfer.local_path)
            .await
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false);
        // Папка назначения должна быть реальной и доступной для навигации
        // уже во время загрузки. Новые файлы внутри неё сразу пишутся в свои
        // целевые пути; существующие заменяются только после полного переноса.
        let created_target_dir = if is_directory {
            match utils::ensure_remote_directory(&channel, &target).await {
                Ok(created) => created,
                Err(message) => {
                    if let Some(group_id) = payload.group_id.as_deref() {
                        state.sftp.unregister_upload_group(group_id).await;
                    }
                    return Err(AppError::Localized(message));
                }
            }
        } else {
            false
        };
        if created_target_dir {
            if let Some(group) = &upload_group {
                group.record_cleanup_path(target.clone()).await;
            }
        }
        let temp = if is_directory {
            target.clone()
        } else {
            utils::temp_remote_path(&target, &transfer.transfer_id)
        };

        state
            .sftp
            .register_transfer(
                &payload.id,
                &transfer.transfer_id,
                channel.clone(),
                Some(temp.clone()),
                payload.delete_remote_partial_on_cancel,
            )
            .await;
        if let Some(group) = &upload_group {
            group.set_active_transfer(Some(transfer.transfer_id.clone())).await;
        }
        if upload_group.as_ref().is_some_and(|group| group.is_cancelled()) {
            state.sftp.unregister_transfer(&transfer.transfer_id).await;
            if let Some(group) = &upload_group {
                group.set_active_transfer(None).await;
            }
            break;
        }

        let aggregate = match tokio::fs::metadata(&transfer.local_path).await {
            Ok(meta) if meta.is_dir() => {
                let total = utils::local_folder_size(Path::new(&transfer.local_path)).await;
                Some(sftp::progress::AggregateState::new(&target, total))
            }
            _ => None,
        };
        let context = transfer_context(
            &app,
            &state,
            &payload.id,
            &transfer.transfer_id,
            sftp::Direction::Upload,
            aggregate,
            upload_group.clone(),
        );

        let outcome = match sftp::transfer::upload_recursive(
            &context,
            &channel,
            Path::new(&transfer.local_path),
            &temp,
            payload.delete_remote_partial_on_cancel,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(message) => {
                if upload_group.as_ref().is_some_and(|group| group.is_cancelled()) {
                    if let Some(group) = &upload_group {
                        cleanup_upload_group(group).await;
                    }
                    state.sftp.unregister_transfer(&transfer.transfer_id).await;
                    if let Some(group) = &upload_group {
                        group.set_active_transfer(None).await;
                    }
                    break;
                }
                let completion_started = state.sftp.try_start_completing(&transfer.transfer_id).await;
                let should_delete = completion_started
                    || state
                        .sftp
                        .should_delete_remote_partial_on_cancel(&transfer.transfer_id)
                        .await;
                if should_delete {
                    if is_directory {
                        if created_target_dir {
                            utils::remove_remote_path(&channel, &target).await;
                        }
                    } else {
                        utils::remove_remote_path(&channel, &temp).await;
                    }
                }
                state.sftp.unregister_transfer(&transfer.transfer_id).await;
                if let Some(group) = &upload_group {
                    group.set_active_transfer(None).await;
                }
                if !completion_started {
                    results.push(sftp::TransferOutcome {
                        remote_path: target,
                        cancelled: Some(true),
                        ..sftp::TransferOutcome::empty()
                    });
                    continue;
                }
                if let Some(group_id) = payload.group_id.as_deref() {
                    state.sftp.unregister_upload_group(group_id).await;
                }
                return Err(AppError::Localized(message));
            }
        };

        // Отмена на любом шаге запрещает промоут; удаление temp-пути зависит от настройки.
        let completion_started = state.sftp.try_start_completing(&transfer.transfer_id).await;
        if outcome.cancelled == Some(true)
            || !completion_started
            || upload_group.as_ref().is_some_and(|group| group.is_cancelled())
        {
            // Даже если upload_recursive вернул cancelled уже после перехода
            // в Completing, удаление частичной папки определяется только
            // пользовательской настройкой.
            let should_delete = state
                .sftp
                .should_delete_remote_partial_on_cancel(&transfer.transfer_id)
                .await;
            if should_delete {
                if is_directory {
                    if created_target_dir {
                        utils::remove_remote_path(&channel, &target).await;
                    }
                } else {
                    utils::remove_remote_path(&channel, &temp).await;
                }
            }
            state.sftp.unregister_transfer(&transfer.transfer_id).await;
            if let Some(group) = &upload_group {
                group.set_active_transfer(None).await;
                cleanup_upload_group(group).await;
            }
            results.push(sftp::TransferOutcome {
                remote_path: target,
                cancelled: Some(true),
                ..sftp::TransferOutcome::empty()
            });
            if upload_group.as_ref().is_some_and(|group| group.is_cancelled()) {
                break;
            }
            continue;
        }

        if !is_directory {
            if let Err(message) = utils::promote_remote_path(&channel, &temp, &target).await {
                utils::remove_remote_path(&channel, &temp).await;
                state.sftp.unregister_transfer(&transfer.transfer_id).await;
                if let Some(group) = &upload_group {
                    group.set_active_transfer(None).await;
                }
                if let Some(group_id) = payload.group_id.as_deref() {
                    state.sftp.unregister_upload_group(group_id).await;
                }
                return Err(AppError::Localized(message));
            }
            if let Some(group) = &upload_group {
                group.record_cleanup_path(target.clone()).await;
            }
        }

        state.sftp.unregister_transfer(&transfer.transfer_id).await;
        if let Some(group) = &upload_group {
            group.set_active_transfer(None).await;
        }
        results.push(sftp::TransferOutcome { remote_path: target, ..outcome });
    }

    if let Some(group_id) = payload.group_id.as_deref() {
        if let Some(group) = &upload_group {
            if group.is_cancelled() {
                cleanup_upload_group(group).await;
            }
        }
        state.sftp.unregister_upload_group(group_id).await;
    }

    Ok(Some(results))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpUploadDirectRequest {
    pub id: String,
    pub local_path: String,
    pub remote_path: String,
    pub transfer_id: Option<String>,
    #[serde(default)]
    pub delete_remote_partial_on_cancel: bool,
}

#[tauri::command]
pub async fn sftp_upload_direct(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpUploadDirectRequest,
) -> AppResult<bool> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Err(AppError::Key("errors.sshClientNotFound"));
    }

    let transfer_id = payload
        .transfer_id
        .clone()
        .unwrap_or_else(|| format!("direct-{}", paths::new_uuid()));
    let target = utils::normalize_remote_path(&payload.remote_path);
    let temp = utils::temp_remote_path(&target, &transfer_id);

    let channel = state
        .sftp
        .transfer_channel(&payload.id)
        .await
        .map_err(AppError::Localized)?;
    state
        .sftp
        .register_transfer(
            &payload.id,
            &transfer_id,
            channel.clone(),
            Some(temp.clone()),
            payload.delete_remote_partial_on_cancel,
        )
        .await;
    let context = transfer_context(&app, &state, &payload.id, &transfer_id, sftp::Direction::Upload, None, None);

    let uploaded = sftp::transfer::put_file(&context, &channel, &payload.local_path, &temp).await;

    match uploaded {
        Ok(_) => {}
        Err(message) => {
            let completion_started = state.sftp.try_start_completing(&transfer_id).await;
            let should_delete = completion_started
                || state
                    .sftp
                    .should_delete_remote_partial_on_cancel(&transfer_id)
                    .await;
            if should_delete {
                utils::remove_remote_path(&channel, &temp).await;
            }
            state.sftp.unregister_transfer(&transfer_id).await;
            if !completion_started {
                return Ok(false);
            }
            return Err(AppError::Localized(message));
        }
    }

    let completion_started = state.sftp.try_start_completing(&transfer_id).await;
    if !completion_started {
        if state
            .sftp
            .should_delete_remote_partial_on_cancel(&transfer_id)
            .await
        {
            utils::remove_remote_path(&channel, &temp).await;
        }
        state.sftp.unregister_transfer(&transfer_id).await;
        return Ok(false);
    }

    if let Err(message) = utils::promote_remote_path(&channel, &temp, &target).await {
        utils::remove_remote_path(&channel, &temp).await;
        state.sftp.unregister_transfer(&transfer_id).await;
        return Err(AppError::Localized(message));
    }

    state.sftp.unregister_transfer(&transfer_id).await;
    Ok(true)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpCancelUploadRequest {
    pub id: String,
    pub remote_path: Option<String>,
    pub transfer_id: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub delete_remote_partial: Option<bool>,
}

#[tauri::command]
pub async fn sftp_cancel_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpCancelUploadRequest,
) -> AppResult<bool> {
    if let Some(group_id) = payload.group_id.as_deref() {
        return Ok(state
            .sftp
            .cancel_upload_group(&app, &payload.id, group_id, payload.delete_remote_partial)
            .await);
    }
    Ok(state
        .sftp
        .cancel_transfer(&app, &payload.id, payload.transfer_id.as_deref(), payload.delete_remote_partial)
        .await)
}

// ── Открытие файлов ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpOpenInEditorRequest {
    pub id: String,
    pub remote_path: String,
    pub filename: String,
    pub transfer_id: Option<String>,
    pub missing_application_title: String,
    pub missing_application_message: String,
}

#[tauri::command]
pub async fn sftp_open_in_editor(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpOpenInEditorRequest,
) -> AppResult<Option<bool>> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Ok(None);
    }
    let transfer_id = payload
        .transfer_id
        .clone()
        .unwrap_or_else(|| format!("editor-{}", paths::new_uuid()));
    crate::logger::info("SFTP", &format!("Opening file in editor: {}", payload.remote_path));

    let (local, watch_cancel) = download_for_watching(
        &app,
        &state,
        &payload.id,
        &transfer_id,
        &payload.remote_path,
        &payload.filename,
    )
    .await?;
    let local_string = local.to_string_lossy().to_string();

    let extension = utils::normalized_extension(&payload.filename);
    let mut app_config = config::load();
    let associated = if extension.is_empty() {
        None
    } else {
        app_config.file_associations.get(&extension).cloned()
    };

    let Some(application_path) = associated else {
        #[cfg(windows)]
        if utils::open_default_application_for_file(&local_string, watch_cancel.clone()).is_err() {
            state.sftp.stop_file_watch(&transfer_id).await;
            return Err(AppError::Key("errors.selectedAppNotFound"));
        }
        #[cfg(not(windows))]
        if let Err(err) = app.opener().open_path(&local_string, None::<&str>) {
            state.sftp.stop_file_watch(&transfer_id).await;
            return Err(AppError::with_source("errors.selectedAppNotFound", err.to_string()));
        }
        return Ok(Some(true));
    };

    if let Ok(child) = utils::launch_application_for_file_tracked(&application_path, &local_string) {
        stop_watch_when_editor_exits(child, watch_cancel.clone());
        return Ok(Some(true));
    }

    // Сохранённого приложения нет: предлагаем выбрать новое или убрать связь.
    let choice = app
        .dialog()
        .message(&payload.missing_application_message)
        .title(&payload.missing_application_title)
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();

    if choice {
        let Some(selected) = crate::commands::select_executable_file(app.clone()).await else {
            state.sftp.stop_file_watch(&transfer_id).await;
            return Ok(None);
        };
        app_config.file_associations.insert(extension, selected.clone());
        let _ = config::save_async(app_config).await;
        match utils::launch_application_for_file_tracked(&selected, &local_string) {
            Ok(child) => stop_watch_when_editor_exits(child, watch_cancel),
            Err(_) => {
                state.sftp.stop_file_watch(&transfer_id).await;
                return Err(AppError::Key("errors.selectedAppNotFound"));
            }
        }
        return Ok(Some(true));
    }

    state.sftp.stop_file_watch(&transfer_id).await;
    app_config.file_associations.remove(&extension);
    let _ = config::save_async(app_config).await;
    Ok(None)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpOpenWithRequest {
    pub id: String,
    pub remote_path: String,
    pub filename: String,
    pub transfer_id: Option<String>,
    pub application_path: Option<String>,
    pub remember_association: Option<bool>,
}

#[tauri::command]
pub async fn sftp_open_with(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpOpenWithRequest,
) -> AppResult<Option<bool>> {
    if state.sftp.session(&payload.id).await.is_none() {
        return Ok(None);
    }
    let transfer_id = payload
        .transfer_id
        .clone()
        .unwrap_or_else(|| format!("openwith-{}", paths::new_uuid()));
    crate::logger::info("SFTP", &format!("Opening file with app: {}", payload.remote_path));

    let (local, watch_cancel) = download_for_watching(
        &app,
        &state,
        &payload.id,
        &transfer_id,
        &payload.remote_path,
        &payload.filename,
    )
    .await?;
    let local_string = local.to_string_lossy().to_string();

    let application_path = match payload.application_path.clone().filter(|value| !value.is_empty()) {
        Some(value) => value,
        None => match crate::commands::select_executable_file(app.clone()).await {
            Some(value) => value,
            None => {
                state.sftp.stop_file_watch(&transfer_id).await;
                return Ok(None);
            }
        },
    };

    match utils::launch_application_for_file_tracked(&application_path, &local_string) {
        Ok(child) => stop_watch_when_editor_exits(child, watch_cancel),
        Err(_) => {
            state.sftp.stop_file_watch(&transfer_id).await;
            return Err(AppError::Key("errors.selectedAppNotFound"));
        }
    }

    let extension = utils::normalized_extension(&payload.filename);
    if !extension.is_empty() && payload.remember_association.unwrap_or(false) {
        let mut app_config = config::load();
        app_config.file_associations.insert(extension, application_path);
        let _ = config::save_async(app_config).await;
    }

    Ok(Some(true))
}

// ── Выбор файлов ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpSelectedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: Option<bool>,
}

#[tauri::command]
pub async fn sftp_select_files(app: AppHandle, mode: String) -> AppResult<Option<Vec<SftpSelectedFile>>> {
    let picked = if mode == "folder" {
        app.dialog().file().blocking_pick_folder().map(|path| vec![path])
    } else {
        app.dialog().file().blocking_pick_files()
    };

    let Some(paths) = picked else { return Ok(None) };
    if paths.is_empty() {
        return Ok(None);
    }

    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        let string = path.to_string();
        let Ok(metadata) = tokio::fs::metadata(&string).await else { continue };
        let is_dir = metadata.is_dir();
        let size = if is_dir {
            utils::local_folder_size(Path::new(&string)).await
        } else {
            metadata.len()
        };
        let name = Path::new(&string)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        results.push(SftpSelectedFile { path: string, name, size, is_dir: Some(is_dir) });
    }
    Ok(Some(results))
}

// ── Вспомогательное ──────────────────────────────────────────────────────────

fn transfer_context(
    app: &AppHandle,
    state: &State<'_, AppState>,
    session_id: &str,
    transfer_id: &str,
    direction: sftp::Direction,
    aggregate: Option<sftp::progress::AggregateState>,
    upload_group: Option<Arc<sftp::SftpUploadGroup>>,
) -> sftp::TransferContext {
    let transfer_active = state.sftp.activity_flag(transfer_id);
    let group_active = upload_group.as_ref().map(Arc::clone);
    sftp::TransferContext {
        app: app.clone(),
        session_id: session_id.to_owned(),
        transfer_id: transfer_id.to_owned(),
        direction,
        batcher: state.sftp.batcher.clone(),
        is_active: Arc::new(move || {
            transfer_active()
                && group_active.as_ref().map(|group| !group.is_cancelled()).unwrap_or(true)
        }),
        aggregate,
        group_cleanup_paths: upload_group.map(|group| group.cleanup_paths_handle()),
    }
}

async fn cleanup_upload_group(group: &sftp::SftpUploadGroup) {
    if !group.should_delete_partial() {
        return;
    }
    for path in group.cleanup_paths_in_reverse_order().await {
        utils::remove_remote_path(&group.sftp, &path).await;
    }
}

/// Скачивает файл во временный каталог и включает наблюдение за изменениями.
async fn download_for_watching(
    app: &AppHandle,
    state: &State<'_, AppState>,
    session_id: &str,
    transfer_id: &str,
    remote_path: &str,
    filename: &str,
) -> AppResult<(PathBuf, tokio::sync::watch::Sender<bool>)> {
    let channel = state
        .sftp
        .transfer_channel(session_id)
        .await
        .map_err(AppError::Localized)?;
    state.sftp.register_transfer(session_id, transfer_id, channel.clone(), None, false).await;

    let context = transfer_context(app, state, session_id, transfer_id, sftp::Direction::Download, None, None);
    let result = sftp::transfer::download_and_watch(&context, &channel, remote_path, filename)
        .await
        .map_err(AppError::Localized);
    state.sftp.unregister_transfer(transfer_id).await;
    let (path, cancel) = result?;
    state.sftp.register_file_watch(session_id, transfer_id, cancel.clone()).await;
    Ok((path, cancel))
}

fn stop_watch_when_editor_exits(
    child: Option<std::process::Child>,
    cancel: tokio::sync::watch::Sender<bool>,
) {
    let Some(child) = child else { return };
    let mut cancelled = cancel.subscribe();
    tauri::async_runtime::spawn(async move {
        let mut child = child;
        let launched_at = std::time::Instant::now();
        loop {
            if *cancelled.borrow() {
                break;
            }
            match child.try_wait() {
                Ok(Some(_)) | Err(_) => {
                    if launched_at.elapsed() >= std::time::Duration::from_secs(2) {
                        cancel.send_replace(true);
                    }
                    break;
                }
                Ok(None) => {}
            }
            tokio::select! {
                _ = cancelled.changed() => {},
                _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {},
            }
        }
    });
}

/// Событие начала трансфера (`sftp-transfer-start-${id}`).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferStartEvent {
    id: String,
    filename: String,
    remote_path: String,
    #[serde(rename = "type")]
    kind: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_dir: Option<bool>,
}

fn emit_transfer_start(
    app: &AppHandle,
    session_id: &str,
    transfer_id: &str,
    filename: &str,
    remote_path: &str,
    is_dir: Option<bool>,
) {
    let _ = app.emit(
        &format!("sftp-transfer-start-{session_id}"),
        TransferStartEvent {
            id: transfer_id.to_owned(),
            filename: filename.to_owned(),
            remote_path: remote_path.to_owned(),
            kind: "download",
            status: "active",
            is_dir,
        },
    );
}

#[cfg(test)]
#[path = "tests/commands_sftp.rs"]
mod tests;
