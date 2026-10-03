//! Команды Tauri — реализация всего IPC-контракта, который раньше
//! обслуживал `electron/src/ipc-handlers.ts`.
//!
//! Имена команд совпадают с каналами Electron (`ssh-connect`,
//! `sftp-readdir`, …), поэтому фронтенд меняется минимально: мост
//! `src/ipc/tauri-bridge.ts` вызывает `invoke('ssh-connect', payload)`.
//!
//! Асинхронные команды (`invoke`) соответствуют `ipcMain.handle`, а команды,
//! помеченные `#[tauri::command]` без `async`, вызываются через `invoke` без
//! ожидания — как `ipcMain.on` в Electron.

use std::collections::BTreeMap;

use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::config::{self, AppConfig, EncryptedSecret, SecretField, SshConfig};
use crate::error::{AppError, AppResult};
use crate::i18n;
use crate::local_terminal::default_shell;
use crate::mcp;
use crate::paths;
use crate::sftp;
use crate::ssh::registry::AuthResponse;
use crate::state::AppState;
use crate::updates;
use crate::vault;
use crate::window;

// ── Конфигурация ─────────────────────────────────────────────────────────────

/// Снимок конфига для синхронного чтения в рендерере.
#[tauri::command]
pub fn get_config() -> AppConfig {
    config::load()
}

/// Асинхронная загрузка конфига (создаёт файл и `clientId` при первом запуске).
#[tauri::command]
pub async fn get_config_async() -> AppResult<AppConfig> {
    Ok(config::load())
}

/// Сохраняет конфиг из рендерера.
///
/// Особенности, унаследованные из Electron-версии:
/// * `cachedRecoveryKey` принадлежит main-процессу и не затирается снимком из
///   рендерера (иначе любое сохранение из UI стирало бы кэш ключа);
/// * `x`, `y`, `width`, `height` принадлежат `save_window_state`, который
///   срабатывает по событиям окна уже после его показа, поэтому снимок из
///   рендерера их не перезаписывает;
/// * обновляется только `maximized`: он читается из окна, потому что на момент
///   первого сохранения геометрия ещё не выправлена;
/// * пароли и парольные фразы из `favorites` переносятся в вольт;
/// * открытый (незашифрованный) приватный ключ не пишется на диск;
/// * выполняется миграция `privateKeyPath` → `privateKey`;
/// * сверяется состояние MCP (только если MCP вообще использовался).
#[tauri::command]
pub async fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    incoming: AppConfig,
) -> AppResult<()> {
    let previous = config::load();
    let mut incoming = incoming;

    config::preserve_cached_recovery_key(&mut incoming);
    // Отпечатки ключей хостов, как и кэш ключа восстановления, принадлежат
    // main-процессу: снимок из рендерера их не содержит.
    config::preserve_fingerprints(&mut incoming);
    // Геометрия принадлежит `window::save_window_state`, который срабатывает по
    // событиям окна уже после его показа. Снимок из рендерера содержит геометрию,
    // загруженную при старте, поэтому без подмены на актуальную любая правка
    // настроек возвращала бы окно к старому размеру и позиции.
    incoming.x = previous.x;
    incoming.y = previous.y;
    incoming.width = previous.width;
    incoming.height = previous.height;
    if let Some(main_window) = app.get_webview_window(window::MAIN_WINDOW) {
        // Обновляется только `maximized`. Раньше геометрия писалась ещё и здесь,
        // то есть ДО выправки размера, и на каждом перезапуске окно разрасталось
        // на 4×5 px.
        if let Ok(maximized) = main_window.is_maximized() {
            incoming.maximized = maximized;
        }
    }

    let unlocked = vault::is_unlocked();
    if let Some(store) = incoming.encrypted_passwords.as_mut() {
        config::sync_favorites_secrets(&mut incoming.favorites, SecretField::Password, store, unlocked);
    } else {
        let mut store: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
        config::sync_favorites_secrets(&mut incoming.favorites, SecretField::Password, &mut store, unlocked);
        incoming.encrypted_passwords = Some(store);
    }
    if let Some(store) = incoming.encrypted_key_passphrases.as_mut() {
        config::sync_favorites_secrets(&mut incoming.favorites, SecretField::KeyPassphrase, store, unlocked);
    } else {
        let mut store: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
        config::sync_favorites_secrets(&mut incoming.favorites, SecretField::KeyPassphrase, &mut store, unlocked);
        incoming.encrypted_key_passphrases = Some(store);
    }

    config::migrate_private_key_paths(&mut incoming);
    // Слоты серверов, которых больше нет в конфиге, удаляются из системного
    // хранилища: `save_config` присылает конфиг целиком, и исчезновение
    // сервера иначе нигде не отмечается.
    crate::secrets::stage_removals(&previous, &incoming);

    config::save_async(incoming.clone())
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err))?;

    // Вольт уже записан и остаётся источником истины: если системное хранилище
    // недоступно или не примет значение, потеря операции ничего не ломает —
    // недостающие записи восстановит миграция следующего запуска.
    crate::secrets::flush().await;

    sync_mcp_after_save(&app, &state, &previous, &incoming).await;
    Ok(())
}

/// `maximized` берётся у окна: на момент первого сохранения геометрия ещё не выправлена.

/// Сверка MCP с конфигом выполняется только если MCP вообще использовался:
/// пока сервер выключен и ни один сервер не открыт, сверять нечего.
async fn sync_mcp_after_save(app: &AppHandle, state: &State<'_, AppState>, previous: &AppConfig, next: &AppConfig) {
    let was_used = previous.mcp_enabled
        || next.mcp_enabled
        || !previous.mcp_allowed_server_ids.is_empty()
        || !next.mcp_allowed_server_ids.is_empty();
    if !was_used {
        return;
    }

    let configured: Vec<&String> = next.favorites.iter().filter_map(|favorite| favorite.id.as_ref()).collect();
    for server_id in &previous.mcp_allowed_server_ids {
        let still_allowed = next.mcp_allowed_server_ids.contains(server_id);
        let still_configured = configured.iter().any(|id| *id == server_id);
        if !still_allowed || !still_configured {
            mcp::revoke_by_server_id(&state.mcp, server_id).await;
        }
    }

    if !next.mcp_enabled {
        mcp::stop(app, &state.mcp, true).await;
    } else if !previous.mcp_enabled
        || previous.mcp_port != next.mcp_port
        || previous.mcp_listen_address != next.mcp_listen_address
    {
        mcp::start(app, &state.mcp).await;
    }
}

/// Рендерер сообщил, что контент отрисован.
#[tauri::command]
pub async fn renderer_content_ready(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.window.lock().await.renderer_content_ready = true;
    window::show_if_ready(&app).await;
    Ok(())
}

// ── Вольт ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub is_unlocked: bool,
    pub is_initialized: bool,
    /// Секреты доступны **без** вольта: они лежат в системном хранилище либо
    /// вольт уже открыт.
    ///
    /// Нужен отдельно от `is_unlocked`: после переноса секретов в системное
    /// хранилище вольт намеренно остаётся закрытым, и по одному `is_unlocked`
    /// интерфейс показывал бы окно ввода ключа пользователю, которому он не
    /// нужен.
    pub secrets_available: bool,
}

/// Заполняет статус без обращений к системному хранилищу и без KDF.
///
/// Функция зовётся рендерером сразу после первого кадра, поэтому всё, что
/// дорого, вынесено в [`recover_vault_in_background`] и в миграцию секретов.
#[tauri::command]
pub async fn vault_get_status() -> AppResult<VaultStatus> {
    let mut config = config::load();
    let needs_resave = config::initialize_vault(&mut config);
    if needs_resave {
        let snapshot = config.clone();
        if let Err(err) = config::save_async(snapshot).await {
            crate::logger::warn("Config", &format!("Vault init save failed: {err}"));
        }
    }

    Ok(build_vault_status(&config))
}

/// Статус хранилища из уже загруженного конфига. Без I/O.
///
/// `secrets_available` отвечает на вопрос «показывать ли окно ввода ключа», и
/// в нём три независимых признака того, что вводить не придётся:
///
/// * вольт уже открыт — читаем напрямую;
/// * секреты целиком в системном хранилище — вольт не нужен вовсе;
/// * ключ восстановления лежит в системном хранилище — фоновая задача откроет
///   вольт сама, и до неё доли секунды;
/// * зашифрованных секретов нет вообще — вводить нечего, даже если соль уже
///   сгенерирована.
///
/// Третий признак особенно важен для секретов, которые не помещаются в хранилище
/// платформы (приватные ключи RSA-3072 и длиннее): они остаются в вольте, метка
/// о переносе всегда `Some(false)`, и без этого признака окно мигало бы до
/// секунды при каждом запуске. Проверка идёт по маркеру в конфиге и не требует
/// ни обращения к хранилищу, ни KDF.
pub fn build_vault_status(config: &AppConfig) -> VaultStatus {
    let is_initialized = config.encryption.as_ref().is_some_and(|value| !value.salt.is_empty());
    let is_unlocked = vault::is_unlocked();

    VaultStatus {
        is_unlocked,
        is_initialized,
        secrets_available: is_unlocked
            || config.secrets_in_system_store == Some(true)
            || config.cached_recovery_key.is_some()
            // Соль появляется в конфиге сразу, а секретов может не быть ещё
            // долго: свежая установка и только что сброшенное хранилище. Ключ
            // восстановления защищает только зашифрованные блобы, поэтому при их
            // отсутствии вводить нечего.
            || !config::has_sealed_secrets(config),
    }
}

/// Сообщает рендереру, что состояние хранилища изменилось.
///
/// Без этого события интерфейс узнал бы о миграции только при следующем
/// вызове `vault_get_status`, а окно ввода ключа успело бы мигнуть.
pub fn emit_vault_status(app: &AppHandle, status: &VaultStatus) {
    if let Err(err) = app.emit("vault-status-changed", status) {
        crate::logger::debug("Vault", &format!("Failed to emit vault status: {err}"));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKeyMaterial {
    pub recovery_key: String,
    pub config: AppConfig,
}

#[tauri::command]
pub async fn vault_init(app: AppHandle) -> AppResult<Option<VaultKeyMaterial>> {
    let mut config = config::load();
    config::initialize_vault(&mut config);

    let already_ready = config
        .encryption
        .as_ref()
        .map(|value| !value.salt.is_empty())
        .unwrap_or(false);
    if already_ready && vault::is_unlocked() {
        return Ok(None);
    }

    let recovery_key = paths::random_base64(32);
    let salt = paths::random_base64(16);
    vault::unlock_async(&recovery_key, &salt)
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;

    let check = vault::encrypt("YASSH_VAULT_VERIFY")
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;
    config.encryption = Some(config::EncryptionInfo { version: 1, salt, check: Some(check) });
    config.encrypted_passwords = Some(BTreeMap::new());
    config.has_acknowledged_recovery_key = Some(false);
    cache_recovery_key(&recovery_key, &mut config).await;

    config::save_async(config.clone())
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;

    let status = build_vault_status(&config);
    emit_vault_status(&app, &status);
    Ok(Some(VaultKeyMaterial { recovery_key, config }))
}

#[tauri::command]
pub async fn vault_unlock(app: AppHandle, recovery_key_input: String) -> AppResult<bool> {    let recovery_key = recovery_key_input.trim();
    if recovery_key.len() < 10 {
        return Ok(false);
    }

    let mut config = config::load();
    config::initialize_vault(&mut config);

    let Some(encryption) = config.encryption.clone() else { return Ok(false) };
    if encryption.salt.is_empty() {
        return Ok(false);
    }
    if vault::unlock_async(&recovery_key, &encryption.salt).await.is_err() {
        vault::lock();
        return Ok(false);
    }

    // Проверяем, что ключ действительно открывает хранилище: иначе пользователь
    // получил бы «успех» и пустые пароли вместо запроса ключа заново.
    let valid = vault::verify(
        encryption.check.as_ref(),
        config.encrypted_passwords.as_ref().and_then(|map| map.values().next()),
    );
    if !valid {
        vault::lock();
        return Ok(false);
    }

    config::migrate_private_key_paths(&mut config);
    cache_recovery_key(recovery_key, &mut config).await;

    // Пользователь только что ввёл ключ руками: вольт открыт, секреты можно
    // перенести в системное хранилище, чтобы в следующий раз их не требовали.
    let report = crate::secrets::migrate_async(config.clone()).await;
    config.secrets_in_system_store = Some(report.is_complete());

    config::save_async(config.clone())
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;
    crate::secrets::flush().await;

    let status = build_vault_status(&config);
    emit_vault_status(&app, &status);
    Ok(true)
}

/// Кладёт ключ в системное хранилище и ставит маркер в конфиг.
///
/// Запись идёт в отдельном потоке: обращение к Credential Manager / Keychain /
/// Secret Service блокирующее, а команда приходит из рендерера и сама
/// `async`.
async fn cache_recovery_key(recovery_key: &str, config: &mut AppConfig) {
    let cached = crate::keychain::write_slot_async(crate::keychain::Slot::RecoveryKey, recovery_key.to_owned()).await;
    if cached {
        crate::logger::info("Vault", "Recovery key cached in system credential store");
        config.cached_recovery_key = Some(crate::keychain::cache_marker().to_owned());
    } else {
        config.cached_recovery_key = None;
    }
}

#[tauri::command]
pub async fn vault_get_recovery_key() -> AppResult<Option<String>> {
    config::ensure_vault_initialized().await;
    Ok(crate::keychain::load_recovery_key_async().await)
}

/// Пароль сервера: сначала системное хранилище, затем вольт.
///
/// Системное хранилище читается в отдельном потоке — команда приходит из
/// рендерера, и блокирующий IPC к Credential Manager занял бы worker tokio.
#[tauri::command]
pub async fn vault_get_password(server_id: String) -> AppResult<Option<String>> {
    if server_id.is_empty() || server_id.len() > 256 {
        return Ok(None);
    }
    let config = config::ensure_vault_initialized().await;

    if let Some(value) = crate::keychain::read_slot_async(crate::keychain::Slot::Password(server_id.clone())).await {
        return Ok(Some(value));
    }
    if !vault::is_unlocked() {
        return Ok(None);
    }
    Ok(config
        .encrypted_passwords
        .as_ref()
        .and_then(|map| map.get(&server_id))
        .and_then(|secret| vault::decrypt(secret).ok()))
}

#[tauri::command]
pub async fn vault_regenerate_key(app: AppHandle) -> AppResult<Option<VaultKeyMaterial>> {
    let mut config = config::ensure_vault_initialized().await;
    if !vault::is_unlocked() {
        return Ok(None);
    }

    // Расшифровываем всё старым ключом: перешифровать можно только то, что
    // читается (иначе содержимое потерялось бы навсегда).
    let mut passwords: Vec<(String, String)> = Vec::new();
    if let Some(map) = config.encrypted_passwords.as_ref() {
        for (id, secret) in map {
            if let Ok(value) = vault::decrypt(secret) {
                passwords.push((id.clone(), value));
            }
        }
    }
    let mut keys: Vec<(String, String)> = Vec::new();
    for favorite in &config.favorites {
        let (Some(id), Some(secret)) = (favorite.id.clone(), favorite.private_key_secret()) else { continue };
        if let Ok(value) = vault::decrypt(&secret) {
            keys.push((id, value));
        }
    }

    let new_recovery_key = paths::random_base64(32);
    let new_salt = paths::random_base64(16);
    vault::unlock_async(&new_recovery_key, &new_salt)
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;

    let mut new_passwords = BTreeMap::new();
    for (id, value) in passwords {
        if let Ok(secret) = vault::encrypt(&value) {
            new_passwords.insert(id, secret);
        }
    }
    config.encrypted_passwords = Some(new_passwords);

    // Перешифровка привязана к стабильному `favorite.id`, а не к индексу.
    for favorite in &mut config.favorites {
        let (Some(id), Some(_)) = (favorite.id.clone(), favorite.private_key.clone()) else { continue };
        match keys.iter().find(|(key_id, _)| *key_id == id) {
            Some((_, content)) => {
                favorite.private_key = vault::encrypt(content).ok().and_then(|secret| serde_json::to_value(secret).ok());
            }
            // Blob не расшифровался старым ключом: удаляем, но `privateKeyPath`
            // остаётся как запасной вариант.
            None => favorite.private_key = None,
        }
    }

    let check = vault::encrypt("YASSH_VAULT_VERIFY")
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;
    config.encryption = Some(config::EncryptionInfo { version: 1, salt: new_salt, check: Some(check) });
    cache_recovery_key(&new_recovery_key, &mut config).await;

    // Сами секреты не менялись — менялась только обёртка, — поэтому записи в
    // системном хранилище остаются годными. Перенос выполняется на случай, если
    // до смены ключа он не прошёл: вольт сейчас открыт, миграция повторится.
    let report = crate::secrets::migrate_async(config.clone()).await;
    config.secrets_in_system_store = Some(report.is_complete());

    config::save_async(config.clone())
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;

    let status = build_vault_status(&config);
    emit_vault_status(&app, &status);
    Ok(Some(VaultKeyMaterial { recovery_key: new_recovery_key, config }))
}

#[tauri::command]
pub async fn vault_reset(app: AppHandle) -> AppResult<VaultKeyMaterial> {
    let mut config = config::ensure_vault_initialized().await;

    // Слоты прежних серверов удаляются до сброса: иначе новый пустой вольт
    // сопровождался бы старыми паролями в системном хранилище, и они всплыли бы
    // при первом же подключении.
    crate::secrets::clear_all_secrets_async(config.clone()).await;

    let recovery_key = paths::random_base64(32);
    let salt = paths::random_base64(16);
    vault::unlock_async(&recovery_key, &salt)
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;

    let check = vault::encrypt("YASSH_VAULT_VERIFY")
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;
    config.encryption = Some(config::EncryptionInfo { version: 1, salt, check: Some(check) });
    config.encrypted_passwords = Some(BTreeMap::new());
    config.encrypted_key_passphrases = None;
    config.has_acknowledged_recovery_key = Some(false);
    // Хранилище пустое, поэтому оно полное по определению.
    config.secrets_in_system_store = Some(true);
    for favorite in &mut config.favorites {
        favorite.private_key = None;
    }
    cache_recovery_key(&recovery_key, &mut config).await;

    config::save_async(config.clone())
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.vaultDecryptFailed", err))?;

    let status = build_vault_status(&config);
    emit_vault_status(&app, &status);
    Ok(VaultKeyMaterial { recovery_key, config })
}

// ── Системные диалоги и системные функции ─────────────────────────────────────

#[tauri::command]
pub async fn select_key_file(app: AppHandle) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .blocking_pick_file();
    picked.map(|path| path.to_string())
}

#[tauri::command]
pub async fn load_private_key_file(app: AppHandle) -> AppResult<Option<String>> {
    let Some(path) = app.dialog().file().blocking_pick_file() else { return Ok(None) };
    let path = path.into_path().map_err(|err| AppError::with_source("errors.readPrivateKeyFailed", err.to_string()))?;
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.readPrivateKeyFailed", err.to_string()))?;
    if !crate::keys::is_supported_private_key_format(&content) {
        return Err(crate::error::AppError::Key("errors.invalidPrivateKey"));
    }
    Ok(Some(content))
}

#[tauri::command]
pub async fn select_executable_file(app: AppHandle) -> Option<String> {
    // На macOS открываем пакет приложений, иначе `.app` не выбрать.
    let picked = if cfg!(target_os = "macos") {
        app.dialog().file().blocking_pick_file()
    } else {
        app.dialog()
            .file()
            .add_filter("Applications", &["app", "exe", "bat", "cmd", "sh"])
            .blocking_pick_file()
    };
    picked.map(|path| path.to_string())
}

/// Читает текст из системного буфера обмена.
///
/// Чтение идёт через нативный API `tauri-plugin-clipboard-manager`, а не через
/// `navigator.clipboard`: WebView2 (Chromium) спрашивает у пользователя
/// разрешение «Просматривать текст и изображения, скопированные в буфер
/// обмена» на каждый вызов асинхронного Clipboard API.
#[tauri::command]
pub async fn read_clipboard_text(app: AppHandle) -> AppResult<String> {
    app.clipboard()
        .read_text()
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err.to_string()))
}

/// Записывает текст в системный буфер обмена (нативный API, без запроса
/// разрешения).
#[tauri::command]
pub async fn write_clipboard_text(app: AppHandle, text: String) -> AppResult<()> {
    app.clipboard()
        .write_text(text)
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err.to_string()))
}

#[tauri::command]
pub async fn encrypt_private_key(content: String) -> AppResult<EncryptedSecret> {
    if !crate::keys::is_supported_private_key_format(&content) {
        return Err(crate::error::AppError::Key("errors.invalidPrivateKey"));
    }
    let mut config = config::load();
    config::initialize_vault(&mut config);
    if !vault::is_unlocked() {
        return Err(crate::error::AppError::Key("errors.vaultLocked"));
    }
    vault::encrypt(&content).map_err(|_| crate::error::AppError::Key("errors.privateKeyEncryptFailed"))
}

#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) {
    // Наружу открываются только http(s): иначе `file://` из рендерера дал бы
    // доступ к локальной файловой системе.
    let trimmed = url.trim();
    if trimmed.len() > 2048 || !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return;
    }
    if let Err(err) = app.opener().open_url(trimmed, None::<&str>) {
        crate::logger::warn("System", &format!("Failed to open external URL: {err}"));
    }
}

#[tauri::command]
pub async fn fs_stat(file_path: String) -> Option<sftp::files::FsStatResult> {
    sftp::files::stat_local(&file_path).await
}

#[tauri::command]
pub async fn log_renderer_msg(level: Option<String>, message: String) {
    let level = crate::logger::Level::parse(level.as_deref().unwrap_or("INFO"));
    crate::logger::add(level, "UI", &message);
}

#[tauri::command]
pub async fn export_logs(app: AppHandle) -> AppResult<bool> {
    let now = chrono::Local::now();
    let default_name = format!(
        "yassh_logs_{:02}.{:02}.{:04}_{:02}.{:02}.log",
        now.day(),
        now.month(),
        now.year(),
        now.hour(),
        now.minute()
    );

    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Log Files (*.log)", &["log"])
        .add_filter("Text Files (*.txt)", &["txt"])
        .add_filter("All Files", &["*"])
        .set_title(&i18n::t("settings.exportLogs", &[]))
        .blocking_save_file()
    else {
        return Ok(false);
    };

    let path = path.into_path().map_err(|err| AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    let text = crate::logger::export_text(env!("CARGO_PKG_VERSION"));
    tokio::fs::write(path, text)
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    Ok(true)
}

// ── Импорт и экспорт конфига ─────────────────────────────────────────────────

#[tauri::command]
pub async fn export_config(app: AppHandle) -> AppResult<bool> {
    let config = config::load();
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name("minissh_config_backup.json")
        .add_filter("JSON", &["json"])
        .set_title(&i18n::t("settings.export", &[]))
        .blocking_save_file()
    else {
        return Ok(false);
    };

    let path = path.into_path().map_err(|err| AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    // В бэкап не попадают открытые секреты: пароли лежат в вольте, а
    // `privateKeyPath` указывает на локальный файл, который у получателя
    // бэкапа не существует.
    let mut snapshot = config;
    for favorite in &mut snapshot.favorites {
        favorite.strip_secrets();
    }

    let text = serde_json::to_string_pretty(&snapshot)
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    tokio::fs::write(path, text)
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    Ok(true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConfigResult {
    pub config: AppConfig,
}

/// Импорт чужого конфига: слоты прежних серверов вычищаются, иначе новый конфиг
/// подхватил бы чужие пароли из системного хранилища.
///
/// `privateKey` сохраняется: blob зашифрован тем же ключом вольта
/// (salt/recovery key), что и `encryptedPasswords` импортированного конфига.
#[tauri::command]
pub async fn import_config(app: AppHandle) -> AppResult<Option<ImportConfigResult>> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_title(&i18n::t("settings.import", &[]))
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let path = path.into_path().map_err(|err| AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    let raw = tokio::fs::read_to_string(path)
        .await
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    let mut incoming: AppConfig = serde_json::from_str(&raw)
        .map_err(|err| crate::error::AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;

    // Legacy-конфиги с серверами без зашифрованных паролей допустимы. Если
    // зашифрованные пароли есть, для их расшифровки обязательна соль.
    let has_passwords = incoming.encrypted_passwords.as_ref().is_some_and(|values| !values.is_empty());
    let has_encryption = incoming.encryption.as_ref().is_some_and(|value| !value.salt.is_empty());
    if has_passwords && !has_encryption {
        return Err(crate::error::AppError::Key("errors.invalidConfigFormat"));
    }

    // Текущее хранилище закрывается до переключения конфига: ключ нового
    // конфига другой, иначе расшифровка чужих блобов падала бы в UI.
    //
    // Заодно вычищаются слоты прежних серверов: импортированный конфиг может
    // содержать те же `id`, и без очистки он подхватил бы чужие пароли из
    // системного хранилища.
    let previous = config::load();
    crate::secrets::clear_all_secrets_async(previous).await;
    vault::lock();
    crate::keychain::clear_cached_recovery_key();
    incoming.cached_recovery_key = None;
    // Слоты прежних серверов удалены, а записи импортированного конфига в
    // системном хранилище ещё нет: перенос выполнит фоновая миграция.
    incoming.secrets_in_system_store = None;

    for favorite in &mut incoming.favorites {
        favorite.password = None;
        favorite.key_passphrase = None;
        // `privateKey` сохраняем: blob зашифрован тем же ключом вольта
        // (salt/recovery key), что и `encryptedPasswords` импортированного конфига.
    }

    config::save_async(incoming).await.ok();
    config::clear_cache();
    Ok(Some(ImportConfigResult { config: config::load() }))
}

// ── Окно ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    if let Some(window) = app.get_webview_window(window::MAIN_WINDOW) {
        if let Err(err) = window.minimize() {
            crate::logger::warn("Window", &format!("Failed to minimize window: {err}"));
        }
    }
}

#[tauri::command]
pub async fn window_maximize(app: AppHandle) {
    let Some(window) = app.get_webview_window(window::MAIN_WINDOW) else { return };
    match window.is_maximized() {
        Ok(true) => {
            if let Err(err) = window.unmaximize() {
                crate::logger::warn("Window", &format!("Failed to restore window: {err}"));
                return;
            }
            window::emit_maximized_state(&app, false).await;
        }
        Ok(false) => {
            if let Err(err) = window.maximize() {
                crate::logger::warn("Window", &format!("Failed to maximize window: {err}"));
                return;
            }
            window::emit_maximized_state(&app, true).await;
        }
        Err(_) => {}
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(window::MAIN_WINDOW) {
        window.close().map_err(|err| AppError::with_source("errors.invalidConfigFormat", err.to_string()))?;
    }
    Ok(())
}

/// Привлекает внимание пользователя: окно мигает только когда свёрнуто.
#[tauri::command]
pub async fn window_flash(app: AppHandle) {
    let Some(window) = app.get_webview_window(window::MAIN_WINDOW) else { return };
    let minimized = window.is_minimized().unwrap_or(false);
    if !minimized {
        return;
    }
    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));

    // Как только окно вернуло фокус, мигание снимается: бесконечное мигание
    // раздражает и мешает работе.
    let app_watch = app.clone();
    let window_watch = window.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            match window_watch.is_focused() {
                Ok(true) => {
                    let _ = window_watch.request_user_attention(None);
                    let _ = app_watch;
                    break;
                }
                Ok(false) => {}
                Err(_) => break,
            }
        }
    });
}

// ── SSH ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectPayload {
    pub id: String,
    pub config: SshConfig,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SshConnectPayload,
) -> AppResult<()> {
    let cols = payload.cols.unwrap_or(80);
    let rows = payload.rows.unwrap_or(24);
    state
        .terminals
        .connect(
            &app,
            &payload.id,
            config_for_connect(payload.config),
            cols,
            rows,
            crate::ssh::SessionAuth::default(),
            0,
        )
        .await;
    Ok(())
}

/// Конфиг для подключения с актуальным отпечатком ключа хоста.
///
/// Снимок из рендерера отпечатка не содержит или содержит устаревший: и то и
/// другое привело бы либо к лишнему вопросу, либо к молчаливому принятию ключа,
/// который пользователь уже удалил. Читается значение, сохранённое в
/// main-процессе.
fn config_for_connect(config: SshConfig) -> SshConfig {
    config::with_stored_fingerprint(&config)
}

#[tauri::command]
pub async fn ssh_auth_response(app: AppHandle, state: State<'_, AppState>, payload: AuthResponse) -> AppResult<()> {
    state.terminals.auth_response(&app, payload).await;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshInputPayload {
    pub id: String,
    pub data: String,
}

#[tauri::command]
pub async fn ssh_input(state: State<'_, AppState>, payload: SshInputPayload) -> AppResult<()> {
    state.terminals.input(&payload.id, &payload.data).await;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshResizePayload {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn ssh_resize(state: State<'_, AppState>, payload: SshResizePayload) -> AppResult<()> {
    state.terminals.resize(&payload.id, payload.cols, payload.rows).await;
    Ok(())
}

#[tauri::command]
pub async fn ssh_get_os_info(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.terminals.os_info(&app, &id).await;
    Ok(())
}

#[tauri::command]
pub async fn ssh_close(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.terminals.close(&id).await;
    Ok(())
}

/// Удаляет сохранённый отпечаток ключа хоста.
///
/// Отдельная команда, а не правка снимка конфига из рендерера: отпечаток
/// принадлежит main-процессу (см. `config::preserve_fingerprints`), иначе любое
/// сохранение настроек стирало бы его как устаревший.
#[tauri::command]
pub async fn ssh_clear_fingerprint(id: String) -> AppResult<()> {
    config::clear_favorite_fingerprint(&id)
        .await
        .map_err(AppError::Localized)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFingerprintResponse {
    pub id: String,
    /// `true` — принять и сохранить, `false` — отклонить.
    pub accept: bool,
}

/// Решение по отпечатку ключа хоста.
///
/// Отдельная команда, а не вариант `ssh_auth_response`: отпечаток спрашивают три
/// разных вида подключения (терминал, SFTP, проброс портов), и ответ приходит
/// тому из них, кто повесил окно, а не реестру авторизации.
#[tauri::command]
pub async fn ssh_fingerprint_response(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SshFingerprintResponse,
) -> AppResult<bool> {
    Ok(state
        .terminals
        .resolve_fingerprint(&app, &payload.id, payload.accept)
        .await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshForwardStartPayload {
    pub id: String,
    pub config: SshConfig,
    pub local_address: String,
    pub local_port: u16,
    pub remote_address: String,
    pub remote_port: u16,
}

#[tauri::command]
pub async fn ssh_forward_start(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SshForwardStartPayload,
) -> AppResult<bool> {
    state
        .terminals
        .forward_start(
            &app,
            &payload.id,
            config_for_connect(payload.config),
            &payload.local_address,
            payload.local_port,
            &payload.remote_address,
            payload.remote_port,
        )
        .await
        .map_err(AppError::Localized)
}

#[tauri::command]
pub async fn ssh_forward_stop(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    Ok(state.terminals.forward_stop(&id).await)
}

// ── Локальный терминал ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTerminalStartPayload {
    pub id: String,
    pub shell: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[tauri::command]
pub async fn local_terminal_start(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: LocalTerminalStartPayload,
) -> AppResult<serde_json::Value> {
    let shell = payload.shell.clone().unwrap_or_else(default_shell);
    let args = payload.args.clone().unwrap_or_default();
    match state
        .local_terminals
        .start(
            &app,
            &payload.id,
            &shell,
            &args,
            payload.cwd.as_deref(),
            payload.cols.unwrap_or(80),
            payload.rows.unwrap_or(24),
        )
        .await
    {
        // Формат ответа — `LocalTerminalStartResult`: { ok: true, pid } либо
        // { ok: false, error } с локализованным текстом.
        Ok(pid) => Ok(serde_json::json!({ "ok": true, "pid": pid })),
        Err(message) => {
            let localized = i18n::t("localTerminal.shellStartError", &[("message", &message)]);
            Ok(serde_json::json!({ "ok": false, "error": localized }))
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTerminalInputPayload {
    pub id: String,
    pub data: String,
}

#[tauri::command]
pub async fn local_terminal_input(state: State<'_, AppState>, payload: LocalTerminalInputPayload) -> AppResult<()> {
    state.local_terminals.input(&payload.id, &payload.data).await;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTerminalResizePayload {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn local_terminal_resize(state: State<'_, AppState>, payload: LocalTerminalResizePayload) -> AppResult<()> {
    state.local_terminals.resize(&payload.id, payload.cols, payload.rows).await;
    Ok(())
}

#[tauri::command]
pub async fn local_terminal_close(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.local_terminals.close(&id).await;
    Ok(())
}

// ── MCP ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_get_status(state: State<'_, AppState>) -> AppResult<mcp::McpStatus> {
    Ok(mcp::status(&state.mcp).await)
}

#[tauri::command]
pub async fn mcp_get_token() -> String {
    mcp::token()
}

#[tauri::command]
pub async fn mcp_get_logs(state: State<'_, AppState>, connection_id: String) -> AppResult<Vec<mcp::LogItem>> {
    Ok(mcp::logs(&state.mcp, &connection_id).await)
}

#[tauri::command]
pub async fn mcp_set_logs_visible(state: State<'_, AppState>, connection_id: String, is_visible: bool) -> AppResult<()> {
    let _ = connection_id;
    mcp::set_logs_visible(&state.mcp, is_visible).await;
    Ok(())
}

#[tauri::command]
pub async fn mcp_toggle(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> AppResult<mcp::McpStatus> {
    let mut config = config::load();
    config.mcp_enabled = enabled;
    let _ = config::save_async(config).await;
    mcp::sync_state(&app, &state.mcp).await;
    Ok(mcp::status(&state.mcp).await)
}

#[tauri::command]
pub async fn mcp_regenerate_token(state: State<'_, AppState>) -> AppResult<mcp::McpStatus> {
    mcp::regenerate_token().await;
    Ok(mcp::status(&state.mcp).await)
}

#[tauri::command]
pub async fn mcp_open_server(app: AppHandle, state: State<'_, AppState>, server_id: String) -> AppResult<mcp::McpStatus> {
    mcp::open_server(&app, &state.mcp, &server_id).await;
    Ok(mcp::status(&state.mcp).await)
}

#[tauri::command]
pub async fn mcp_close_server(app: AppHandle, state: State<'_, AppState>, server_id: String) -> AppResult<mcp::McpStatus> {
    mcp::close_server(&app, &state.mcp, &server_id).await;
    Ok(mcp::status(&state.mcp).await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfirmCommandPayload {
    pub id: String,
    pub approved: bool,
}

#[tauri::command]
pub async fn mcp_confirm_command(app: AppHandle, state: State<'_, AppState>, payload: McpConfirmCommandPayload) -> AppResult<bool> {
    Ok(mcp::confirm_command(&app, &state.mcp, &payload.id, payload.approved).await)
}

#[tauri::command]
pub async fn mcp_cancel_run(state: State<'_, AppState>, run_id: String) -> AppResult<bool> {
    Ok(mcp::cancel_run(&state.mcp, &run_id).await)
}

// ── Обновления ───────────────────────────────────────────────────────────────

/// Проверка обновлений.
///
/// `allow_pre_release` приходит из рендерера, а не из конфига: запись
/// конфига от Debounce-таймера отстаёт от переключателя в настройках, и
/// проверка сразу после клика увидела бы старое значение.
#[tauri::command]
pub async fn check_updates(
    app: AppHandle,
    state: State<'_, AppState>,
    allow_pre_release: bool,
) -> AppResult<updates::CheckUpdateResult> {
    updates::set_last_check(&state.updater).await;
    Ok(updates::check(&app, &state.updater, allow_pre_release).await)
}

#[tauri::command]
pub async fn start_update_download(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(updates::start_download(&app, &state.updater).await)
}

/// Установка скачанного обновления и перезапуск.
///
/// Отдельна от скачивания: пользователь сам выбирает момент, когда
/// приложение будет заменено.
#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    updates::install_update(&app, &state.updater).await.map_err(AppError::from)
}

// ── Служебное ────────────────────────────────────────────────────────────────

/// Платформа в терминах renderer (`win32` | `darwin` | `linux`).
#[tauri::command]
pub fn platform() -> String {
    paths::platform_id().to_owned()
}

/// Сессия закрыта: убираем её из реестров и сообщаем SFTP-вкладке.
///
/// Вызывается из SSH-регистра, когда канал оболочки закрылся: у вкладки SFTP
/// с тем же `id` соединение тоже неактивно, и UI должен узнать об этом.
pub fn mark_session_closed(app: &AppHandle, id: &str) {
    let id = id.to_owned();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else { return };
        state
            .sftp
            .notify_connection_closed(&app, &id, sftp::SftpStatusKind::ConnectionClosed)
            .await;
    });
}

#[cfg(test)]
#[path = "tests/commands.rs"]
mod tests;
