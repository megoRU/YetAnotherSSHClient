//! SFTP-команды — часть IPC-контракта, раньше обслуживавшаяся
//! `sftpManager` в `electron/src/ipc-handlers.ts`.
//!
//! Вынесены отдельным модулем, чтобы `commands.rs` оставался читаемым: здесь
//! сосредоточены операции с файлами, трансферы и диалоги выбора пути.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::config::{self, SshConfig};
use crate::error::{AppError, AppResult};
use crate::i18n;
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
pub async fn sftp_connect(app: AppHandle, state: State<'_, AppState>, payload: SftpConnectPayload) {
    state.sftp.connect(&app, &payload.id, payload.config).await;
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
    sftp::files::mkdir(&sftp, &payload.path).await.map(|()| true).map_err(AppError::Localized)
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
        .map(|()| true)
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
        .map(|()| true)
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
        .map(|()| true)
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
) -> AppResult<Option<SftpDownloadResult>> {
    let Some(entry) = state.sftp.session(&payload.id).await else { return Ok(None) };

    let Some(local) = app
        .dialog()
        .file()
        .set_file_name(&payload.filename)
        .set_title(&i18n::t("sftp.download", &[]))
        .blocking_save_file()
    else {
        return Ok(None);
    };

    emit_transfer_start(&app, &payload.id, &payload.transfer_id, &payload.filename, &payload.remote_path, None);

    let metadata = entry
        .sftp
        .metadata(payload.remote_path.clone())
        .await
        .map_err(|err| AppError::Localized(err.to_string()))?;

    let context = transfer_context(
        &app,
        &state,
        &payload.id,
        &payload.transfer_id,
        sftp::Direction::Download,
        if utils::is_dir(&metadata) {
            let total = utils::remote_folder_size(&entry.sftp, &payload.remote_path, 0).await;
            Some(sftp::progress::AggregateState::new(&payload.remote_path, total))
        } else {
            None
        },
    );

    let outcome = sftp::transfer::download_recursive(&context, &entry.sftp, &payload.remote_path, &local)
        .await
        .map_err(AppError::Localized)?;
    state.sftp.unregister_transfer(&payload.transfer_id).await;

    Ok(Some(SftpDownloadResult {
        remote_path: outcome.remote_path,
        local_path: outcome.local_path,
        is_dir: outcome.is_dir,
        size: outcome.size,
    }))
}

#[derive(Deserialize)]
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

    let Some(directory) = app.dialog().file().pick_folder().blocking_pick_folder() else {
        return Ok(None);
    };

    let mut results: Vec<Option<SftpDownloadResult>> = Vec::with_capacity(payload.files.len());
    for file in payload.files {
        let Some(entry) = state.sftp.session(&payload.id).await else {
            results.push(None);
            continue;
        };

        emit_transfer_start(
            &app,
            &payload.id,
            &file.transfer_id,
            &file.filename,
            &file.remote_path,
            file.is_dir,
        );

        let aggregate = if file.is_dir == Some(true) {
            let total = utils::remote_folder_size(&entry.sftp, &file.remote_path, 0).await;
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
        );

        let local = directory.join(&file.filename);
        let outcome = sftp::transfer::download_recursive(&context, &entry.sftp, &file.remote_path, &local)
            .await
            .map_err(AppError::Localized)?;
        state.sftp.unregister_transfer(&file.transfer_id).await;

        results.push(Some(SftpDownloadResult {
            remote_path: outcome.remote_path,
            local_path: outcome.local_path,
            is_dir: outcome.is_dir,
            size: outcome.size,
        }));
    }

    Ok(Some(results))
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

    // Собственный SFTP-канал на всю операцию: отмена одной загрузки не должна
    // затрагивать остальные загрузки той же вкладки.
    let channel = state
        .sftp
        .transfer_channel(&payload.id)
        .await
        .map_err(AppError::Localized)?;

    let mut results: Vec<sftp::TransferOutcome> = Vec::with_capacity(payload.transfers.len());
    for transfer in payload.transfers {
        let filename = Path::new(&transfer.local_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let target = utils::normalize_remote_path(&format!("{}/{}", payload.remote_dir, filename));
        let temp = utils::temp_remote_path(&target, &transfer.transfer_id);

        state
            .sftp
            .register_transfer(&payload.id, &transfer.transfer_id, channel.clone(), Some(temp.clone()))
            .await;

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
        );

        let outcome = match sftp::transfer::upload_recursive(&context, &channel, Path::new(&transfer.local_path), &temp)
            .await
        {
            Ok(outcome) => outcome,
            Err(message) => {
                utils::remove_remote_path(&channel, &temp).await;
                state.sftp.unregister_transfer(&transfer.transfer_id).await;
                return Err(AppError::Localized(message));
            }
        };

        // Отмена на любом шаге запрещает промоут: temp-путь удаляется.
        let cancelled = !state.sftp.is_transfer_active(&transfer.transfer_id).await || outcome.cancelled == Some(true);
        if cancelled || !state.sftp.try_start_completing(&transfer.transfer_id).await {
            utils::remove_remote_path(&channel, &temp).await;
            state.sftp.unregister_transfer(&transfer.transfer_id).await;
            results.push(sftp::TransferOutcome {
                remote_path: target,
                cancelled: Some(true),
                ..sftp::TransferOutcome::empty()
            });
            continue;
        }

        if let Err(message) = utils::promote_remote_path(&channel, &temp, &target).await {
            utils::remove_remote_path(&channel, &temp).await;
            state.sftp.unregister_transfer(&transfer.transfer_id).await;
            return Err(AppError::Localized(message));
        }

        state.sftp.unregister_transfer(&transfer.transfer_id).await;
        results.push(sftp::TransferOutcome { remote_path: target, ..outcome });
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
        .register_transfer(&payload.id, &transfer_id, channel.clone(), Some(temp.clone()))
        .await;
    let context = transfer_context(&app, &state, &payload.id, &transfer_id, sftp::Direction::Upload, None);

    let uploaded = sftp::transfer::put_file(&context, &channel, &payload.local_path, &temp).await;

    let cancelled = match &uploaded {
        Ok(_) => {
            !state.sftp.is_transfer_active(&transfer_id).await
                || !state.sftp.try_start_completing(&transfer_id).await
        }
        Err(_) => false,
    };
    if cancelled {
        utils::remove_remote_path(&channel, &temp).await;
        state.sftp.unregister_transfer(&transfer_id).await;
        return Ok(false);
    }

    if let Err(message) = uploaded {
        utils::remove_remote_path(&channel, &temp).await;
        state.sftp.unregister_transfer(&transfer_id).await;
        return Err(AppError::Localized(message));
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
}

#[tauri::command]
pub async fn sftp_cancel_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpCancelUploadRequest,
) -> AppResult<bool> {
    Ok(state
        .sftp
        .cancel_transfer(&app, &payload.id, payload.transfer_id.as_deref())
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
}

#[tauri::command]
pub async fn sftp_open_in_editor(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SftpOpenInEditorRequest,
) -> AppResult<Option<bool>> {
    let Some(entry) = state.sftp.session(&payload.id).await else { return Ok(None) };
    let transfer_id = payload
        .transfer_id
        .clone()
        .unwrap_or_else(|| format!("editor-{}", paths::new_uuid()));
    crate::logger::info("SFTP", &format!("Opening file in editor: {}", payload.remote_path));

    let local = download_for_watching(
        &app,
        &state,
        &payload.id,
        &transfer_id,
        &entry,
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
        app.opener()
            .open_path(&local_string, None::<&str>)
            .map_err(|err| AppError::with_source("errors.selectedAppNotFound", err.to_string()))?;
        return Ok(Some(true));
    };

    if utils::launch_application_for_file(&application_path, &local_string).is_ok() {
        return Ok(Some(true));
    }

    // Сохранённого приложения нет: предлагаем выбрать новое или убрать связь.
    let english = app_config.language == "en";
    let title = if english {
        "File association is unavailable"
    } else {
        "Файловая ассоциация недоступна"
    };
    let message = if english {
        format!("Saved application for {extension} was not found.")
    } else {
        format!("Сохраненное приложение для {extension} не найдено.")
    };
    let buttons: Vec<&str> = if english {
        vec!["Choose new application", "Remove association", "Cancel"]
    } else {
        vec!["Выбрать новое приложение", "Удалить ассоциацию", "Отмена"]
    };

    let choice = app
        .dialog()
        .message(format!("{message}\n\n{application_path}"))
        .title(title)
        .buttons(buttons.clone())
        .blocking_show();

    if choice == buttons[0] {
        let Some(selected) = crate::commands::select_executable_file(app.clone()).await else {
            return Ok(None);
        };
        app_config.file_associations.insert(extension, selected.clone());
        let _ = config::save_async(app_config).await;
        utils::launch_application_for_file(&selected, &local_string)
            .map_err(|_| AppError::Key("errors.selectedAppNotFound"))?;
        return Ok(Some(true));
    }

    if choice == buttons[1] {
        app_config.file_associations.remove(&extension);
        let _ = config::save_async(app_config).await;
    }
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
    let Some(entry) = state.sftp.session(&payload.id).await else { return Ok(None) };
    let transfer_id = payload
        .transfer_id
        .clone()
        .unwrap_or_else(|| format!("openwith-{}", paths::new_uuid()));
    crate::logger::info("SFTP", &format!("Opening file with app: {}", payload.remote_path));

    let local = download_for_watching(
        &app,
        &state,
        &payload.id,
        &transfer_id,
        &entry,
        &payload.remote_path,
        &payload.filename,
    )
    .await?;
    let local_string = local.to_string_lossy().to_string();

    let application_path = match payload.application_path.clone().filter(|value| !value.is_empty()) {
        Some(value) => value,
        None => match crate::commands::select_executable_file(app.clone()).await {
            Some(value) => value,
            None => return Ok(None),
        },
    };

    utils::launch_application_for_file(&application_path, &local_string)
        .map_err(|_| AppError::Key("errors.selectedAppNotFound"))?;

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
        app.dialog().file().pick_folder().blocking_pick_folder()
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
) -> sftp::TransferContext {
    sftp::TransferContext {
        app: app.clone(),
        session_id: session_id.to_owned(),
        transfer_id: transfer_id.to_owned(),
        direction,
        batcher: state.sftp.batcher.clone(),
        is_active: state.sftp.activity_flag(transfer_id),
        aggregate,
    }
}

/// Скачивает файл во временный каталог и включает наблюдение за изменениями.
async fn download_for_watching(
    app: &AppHandle,
    state: &State<'_, AppState>,
    session_id: &str,
    transfer_id: &str,
    entry: &sftp::session::SftpSessionEntry,
    remote_path: &str,
    filename: &str,
) -> AppResult<PathBuf> {
    let channel = state
        .sftp
        .transfer_channel(session_id)
        .await
        .map_err(AppError::Localized)?;
    state.sftp.register_transfer(session_id, transfer_id, channel.clone(), None).await;

    let context = transfer_context(app, state, session_id, transfer_id, sftp::Direction::Download, None);
    let result = sftp::transfer::download_and_watch(&context, &channel, remote_path, filename)
        .await
        .map_err(AppError::Localized);
    state.sftp.unregister_transfer(transfer_id).await;
    result
}

/// Событие начала трансфера (`sftp-transfer-start-${id}`).
#[derive(Serialize)]
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
        format!("sftp-transfer-start-{session_id}"),
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
