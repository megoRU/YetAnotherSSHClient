//! Конфигурация приложения — порт `electron/src/config.ts`.
//!
//! Формат файла **не меняется**: `~/.minissh_config.json` читается и пишется
//! теми же полями, что и Electron-версия. Это делает бэкапы взаимозаменяемыми
//! между сборками и позволяет перейти на Tauri без потери серверов, паролей и
//! ключей.
//!
//! Важно: `favorites` объявлен последним полем `AppConfig` (правило проекта).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::keys;
use crate::logger;
use crate::paths;
use crate::vault;

// ── Типы, зеркалящие src/types.ts ─────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedSecret {
    pub iv: String,
    pub tag: String,
    pub data: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionInfo {
    pub version: u32,
    pub salt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<EncryptedSecret>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub user: String,
    pub host: String,
    #[serde(deserialize_with = "deserialize_port")]
    pub port: u16,
    /// Пароль, введённый пользователем. Никогда не попадает на диск: перед
    /// сохранением переносится в `encryptedPasswords[id]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Парольная фраза зашифрованного ключа; переносится в
    /// `encryptedKeyPassphrases[id]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key: Option<serde_json::Value>,
    /// Legacy-поле: путь к ключу на диске. Мигрируется в `private_key`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub os_pretty_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_commands: Option<String>,
}

/// Electron reads favorite objects as plain JSON and historically allowed a
/// numeric port to remain a string in the config file. Accept both JSON forms
/// while keeping the Rust-side port strongly typed.
fn deserialize_port<'de, D>(deserializer: D) -> Result<u16, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Port {
        Number(u16),
        Text(String),
    }

    match Port::deserialize(deserializer)? {
        Port::Number(port) => Ok(port),
        Port::Text(port) => port.parse().map_err(serde::de::Error::custom),
    }
}

impl SshConfig {
    pub fn auth_type_is_key(&self) -> bool {
        self.auth_type.as_deref() == Some("key")
    }

    pub fn effective_port(&self) -> u16 {
        if self.port == 0 {
            22
        } else {
            self.port
        }
    }

    pub fn user_name(&self) -> &str {
        self.user.trim()
    }

    /// Читает зашифрованный ключ в типизированный вид.
    pub fn private_key_secret(&self) -> Option<EncryptedSecret> {
        let value = self.private_key.as_ref()?;
        serde_json::from_value(value.clone()).ok()
    }

    /// Убирает `password`/`keyPassphrase`/`privateKeyPath` перед записью.
    pub fn strip_secrets(&mut self) {
        self.password = None;
        self.key_passphrase = None;
        self.private_key_path = None;
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encryption: Option<EncryptionInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_passwords: Option<BTreeMap<String, EncryptedSecret>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_key_passphrases: Option<BTreeMap<String, EncryptedSecret>>,
    /// Кэш ключа восстановления. В Tauri-сборке сюда кладётся **не** сам ключ,
    /// а признак того, что ключ лежит в системном хранилище (см. `keychain.rs`).
    /// Поле сохранено ради совместимости формата.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_recovery_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_acknowledged_recovery_key: Option<bool>,
    pub terminal_font_name: String,
    pub terminal_font_size: u16,
    pub ui_font_name: String,
    pub ui_font_size: u16,
    pub theme: String,
    pub language: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_update_check: Option<i64>,
    pub enable_terminal_context_menu: bool,
    pub terminal_scroll_sensitivity: u16,
    pub keyword_highlighting: bool,
    pub sftp_sound_enabled: bool,
    pub sftp_sound_volume: f32,
    pub sftp_flash_icon: bool,
    pub active_tab_color_enabled: bool,
    pub always_show_hover_on_inactive_tabs: bool,
    pub server_card_size: String,
    pub is_onboarding_completed: bool,
    pub sidebar_enabled: bool,
    pub sidebar_position: String,
    pub file_associations: BTreeMap<String, String>,
    pub mcp_enabled: bool,
    pub mcp_port: u16,
    pub mcp_token: String,
    pub mcp_require_confirmation: bool,
    pub mcp_allowed_server_ids: Vec<String>,
    pub client_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license_expires_at: Option<i64>,
    // Правило проекта: favorites всегда последнее поле.
    pub favorites: Vec<SshConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        default_config()
    }
}

// ── Значения по умолчанию ────────────────────────────────────────────────────

/// Конфиг по умолчанию (порт `DEFAULT_CONFIG` из `electron/src/config.ts`).
pub fn default_config() -> AppConfig {
    AppConfig {
        encryption: None,
        encrypted_passwords: None,
        encrypted_key_passphrases: None,
        cached_recovery_key: None,
        has_acknowledged_recovery_key: Some(false),
        terminal_font_name: "JetBrains Mono".to_owned(),
        terminal_font_size: 17,
        ui_font_name: "JetBrains Mono".to_owned(),
        ui_font_size: 13,
        theme: "Auto".to_owned(),
        language: "ru".to_owned(),
        x: 353,
        y: 141,
        width: 1277,
        height: 911,
        maximized: false,
        last_update_check: Some(0),
        enable_terminal_context_menu: false,
        terminal_scroll_sensitivity: 2,
        keyword_highlighting: true,
        sftp_sound_enabled: true,
        sftp_sound_volume: 0.5,
        sftp_flash_icon: true,
        active_tab_color_enabled: false,
        always_show_hover_on_inactive_tabs: false,
        server_card_size: "standard".to_owned(),
        is_onboarding_completed: false,
        sidebar_enabled: false,
        sidebar_position: "left".to_owned(),
        file_associations: BTreeMap::new(),
        mcp_enabled: false,
        mcp_port: 3000,
        mcp_token: random_hex(16),
        mcp_require_confirmation: true,
        mcp_allowed_server_ids: Vec::new(),
        client_id: String::new(),
        license_key: None,
        license_expires_at: None,
        favorites: Vec::new(),
    }
}

fn random_hex(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    if getrandom::fill(&mut bytes).is_err() {
        return paths::new_uuid().replace('-', "");
    }
    hex::encode(bytes)
}

// ── Кэш и путь ───────────────────────────────────────────────────────────────

fn cache() -> &'static Mutex<Option<AppConfig>> {
    static CACHE: OnceLock<Mutex<Option<AppConfig>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn config_path() -> Option<PathBuf> {
    paths::config_path()
}

/// Сбрасывает кэш, чтобы следующая загрузка прочитала файл заново.
pub fn clear_cache() {
    if let Ok(mut guard) = cache().lock() {
        *guard = None;
    }
}

/// Загружает конфигурацию (с кэшем в памяти).
///
/// Гарантии, как и в Electron-версии:
/// * отсутствующий файл → значения по умолчанию;
/// * отсутствующие поля старой версии → значения по умолчанию;
/// * старый конфиг без `isOnboardingCompleted` считается настроенным;
/// * `clientId` всегда существует и сразу фиксируется на диске.
pub fn load() -> AppConfig {
    if let Ok(guard) = cache().lock() {
        if let Some(config) = guard.as_ref() {
            return config.clone();
        }
    }

    let mut config = match read_from_disk() {
        Some(config) => config,
        None => {
            let mut fresh = default_config();
            fresh.language = detect_system_language();
            fresh
        }
    };

    if config.client_id.is_empty() {
        config.client_id = paths::new_uuid();
        // Не заменяем существующий файл дефолтами, если он повреждён или
        // недоступен. Старые схемы уже читаются через serde(default).
        if config_path().is_some_and(|path| !path.exists() || read_existing_config(&path).is_ok()) {
            let _ = save(&config);
        }
    }

    if let Ok(mut guard) = cache().lock() {
        *guard = Some(config.clone());
    }
    config
}

fn read_from_disk() -> Option<AppConfig> {
    let path = config_path()?;
    if !path.exists() {
        return None;
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            logger::warn("Config", &format!("Failed to read config: {err}"));
            return None;
        }
    };

    // Сначала читаем в динамический JSON, чтобы отличить «поле отсутствует»
    // от «поле равно false» — иначе миграция старых конфигов ломается.
    let mut value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            logger::warn("Config", &format!("Corrupted config; original file left untouched: {err}"));
            return None;
        }
    };

    let Some(object) = value.as_object_mut() else {
        return None;
    };

    if !object.contains_key("isOnboardingCompleted") {
        object.insert("isOnboardingCompleted".to_owned(), serde_json::Value::Bool(true));
    }

    let mut config: AppConfig = match serde_json::from_value(value) {
        Ok(config) => config,
        Err(err) => {
            logger::warn("Config", &format!("Config schema mismatch; original file left untouched: {err}"));
            return None;
        }
    };

    normalize(&mut config);
    Some(config)
}

/// Приводит необязательные поля к значениям по умолчанию (порт блоков
/// миграции из `loadConfig`).
fn normalize(config: &mut AppConfig) {
    if config.theme.is_empty() {
        config.theme = "Auto".to_owned();
    }
    if config.language.is_empty() {
        config.language = "ru".to_owned();
    }
    if config.server_card_size.is_empty() {
        config.server_card_size = "standard".to_owned();
    }
    if config.sidebar_position.is_empty() {
        config.sidebar_position = "left".to_owned();
    }
    if config.terminal_font_name.is_empty() {
        config.terminal_font_name = "JetBrains Mono".to_owned();
    }
    if config.ui_font_name.is_empty() {
        config.ui_font_name = "JetBrains Mono".to_owned();
    }
    if config.terminal_font_size == 0 {
        config.terminal_font_size = 17;
    }
    if config.ui_font_size == 0 {
        config.ui_font_size = 13;
    }
    if config.terminal_scroll_sensitivity == 0 {
        config.terminal_scroll_sensitivity = 2;
    }
    if config.mcp_port == 0 {
        config.mcp_port = 3000;
    }
    if config.mcp_token.is_empty() {
        config.mcp_token = random_hex(16);
    }
    if config.sftp_sound_volume <= 0.0 || config.sftp_sound_volume > 1.0 {
        config.sftp_sound_volume = 0.5;
    }
}

fn detect_system_language() -> String {
    for key in ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            let locale = value.split('.').next().unwrap_or("").to_ascii_lowercase();
            if locale.starts_with("en") {
                return "en".to_owned();
            }
            if locale.starts_with("ru") {
                return "ru".to_owned();
            }
        }
    }
    "ru".to_owned()
}

// ── Сохранение ───────────────────────────────────────────────────────────────

/// Готовит копию конфига к записи: вырезает секреты и plaintext-ключи.
fn prepare_for_disk(config: &AppConfig) -> AppConfig {
    let mut snapshot = config.clone();

    for favorite in &mut snapshot.favorites {
        favorite.strip_secrets();
        strip_plaintext_private_key(favorite);
    }

    snapshot
}

/// Гарантирует непустой `clientId`, не теряя уже записанный.
fn ensure_client_id_standalone(config: &mut AppConfig) {
    if !config.client_id.is_empty() {
        return;
    }
    config.client_id = cache()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|current| current.client_id.clone()))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(paths::new_uuid);
}

/// Не допускает записи открытого приватного ключа: при доступном хранилище он
/// шифруется на лету, иначе удаляется (порт `stripPlaintextPrivateKeys`).
fn strip_plaintext_private_key(favorite: &mut SshConfig) {
    let Some(raw) = favorite.private_key.clone() else { return };

    if let Ok(secret) = serde_json::from_value::<EncryptedSecret>(raw.clone()) {
        favorite.private_key = Some(serde_json::to_value(secret).unwrap_or(raw));
        return;
    }

    if let Some(text) = raw.as_str() {
        if vault::is_unlocked() {
            if let Ok(secret) = vault::encrypt(text) {
                favorite.private_key = serde_json::to_value(secret).ok();
                return;
            }
        }
    }

    logger::warn(
        "Config",
        &format!("Removed non-encrypted private key for server {}", favorite.id.as_deref().unwrap_or("?")),
    );
    favorite.private_key = None;
}

/// Синхронное сохранение (используется только на старте и в тестах).
pub fn save(config: &AppConfig) -> Result<(), String> {
    let mut owned = config.clone();
    ensure_client_id_standalone(&mut owned);

    let snapshot = prepare_for_disk(&owned);
    let path = config_path().ok_or_else(|| "Не удалось определить путь конфига".to_owned())?;
    read_existing_config(&path)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(&snapshot).map_err(|err| err.to_string())?;
    std::fs::write(&path, text).map_err(|err| err.to_string())?;
    set_cache(owned);
    Ok(())
}

/// Атомарное сохранение через временный файл + rename.
///
/// Записи сериализуются глобальной очередью: конфиг пишется из IPC-обработчиков
/// и из задач фоновой миграции, поэтому гонка привела бы к повреждению файла.
pub async fn save_async(config: AppConfig) -> Result<(), String> {
    static WRITE_QUEUE: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    let queue = WRITE_QUEUE.get_or_init(|| tokio::sync::Mutex::new(()));

    let mut owned = config;
    ensure_client_id_standalone(&mut owned);
    let snapshot = prepare_for_disk(&owned);
    let text = serde_json::to_string_pretty(&snapshot).map_err(|err| err.to_string())?;
    let path = config_path().ok_or_else(|| "Не удалось определить путь конфига".to_owned())?;
    read_existing_config(&path)?;

    let result = {
        let _guard = queue.lock().await;
        write_atomic(&path, &text).await
    };

    set_cache(owned);
    result
}

/// Не позволяет сохранению поверх существующего нечитаемого файла уничтожить
/// данные пользователя. Отсутствующий файл и старые схемы допустимы.
fn read_existing_config(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(path).map_err(|err| format!("Не удалось прочитать существующий конфиг: {err}"))?;
    let mut value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| format!("Существующий конфиг повреждён и оставлен без изменений: {err}"))?;
    if let Some(object) = value.as_object_mut() {
        if !object.contains_key("isOnboardingCompleted") {
            object.insert("isOnboardingCompleted".to_owned(), serde_json::Value::Bool(true));
        }
    }
    serde_json::from_value::<AppConfig>(value)
        .map(|_| ())
        .map_err(|err| format!("Схема существующего конфига не распознана; файл оставлен без изменений: {err}"))
}

async fn write_atomic(path: &PathBuf, contents: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|err| err.to_string())?;
    }
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));

    // Синхронный rename после async-записи: файл уже закрыт, а поведение
    // замены совпадает с Electron-версией на всех трёх платформах.
    if let Err(err) = tokio::fs::write(&temp, contents.as_bytes()).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(err.to_string());
    }
    if let Err(err) = std::fs::rename(&temp, path) {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(err.to_string());
    }
    Ok(())
}

fn set_cache(config: AppConfig) {
    if let Ok(mut guard) = cache().lock() {
        *guard = Some(config);
    }
}

// ── Секреты в избранном ──────────────────────────────────────────────────────

/// Поле `SSHConfig`, которое переносится из `favorites` в зашифрованное хранилище.
#[derive(Debug, Clone, Copy)]
pub enum SecretField {
    Password,
    KeyPassphrase,
}

/// Переносит `password`/`keyPassphrase` из `favorites` в `store`.
///
/// Семантика как в Electron: пустая строка означает «секрет удалён», отсутствие
/// ключа — «не менялся». При закрытом хранилище непустой секрет остаётся в поле
/// и будет срезан [`prepare_for_disk`] перед записью на диск.
pub fn sync_favorites_secrets(
    favorites: &mut [SshConfig],
    field: SecretField,
    store: &mut BTreeMap<String, EncryptedSecret>,
    unlocked: bool,
) {
    for favorite in favorites.iter_mut() {
        let Some(id) = favorite.id.clone() else { continue };

        let current = match field {
            SecretField::Password => favorite.password.clone(),
            SecretField::KeyPassphrase => favorite.key_passphrase.clone(),
        };
        let Some(current) = current else { continue };

        if current.is_empty() {
            store.remove(&id);
            match field {
                SecretField::Password => favorite.password = None,
                SecretField::KeyPassphrase => favorite.key_passphrase = None,
            }
            continue;
        }

        if !unlocked {
            continue;
        }

        match vault::encrypt(&current) {
            Ok(secret) => {
                store.insert(id, secret);
            }
            Err(err) => logger::warn("Config", &format!("Failed to encrypt secret for {id}: {err}")),
        }
        match field {
            SecretField::Password => favorite.password = None,
            SecretField::KeyPassphrase => favorite.key_passphrase = None,
        }
    }
}

/// Расшифрованный пароль сервера (из хранилища, затем из самого конфига).
pub fn resolve_password(config: &SshConfig) -> Result<Option<String>, String> {
    if let Some(id) = config.id.as_ref() {
        let app = load();
        if let Some(stored) = app.encrypted_passwords.as_ref().and_then(|map| map.get(id)) {
            return match vault::decrypt(stored) {
                Ok(value) => Ok(Some(value)),
                Err(_) => Err("errors.vaultDecryptFailed".to_owned()),
            };
        }
    }
    Ok(config.password.clone())
}

/// Расшифрованная парольная фраза ключа, сохранённая в хранилище.
pub fn resolve_stored_key_passphrase(config: &SshConfig) -> Option<String> {
    let id = config.id.as_ref()?;
    let app = load();
    let stored = app
        .encrypted_key_passphrases
        .as_ref()
        .and_then(|map| map.get(id))?;
    vault::decrypt(stored).ok()
}

/// Гарантирует непустой `clientId` (используется миграциями).
pub fn ensure_client_id(config: &mut AppConfig) -> String {
    if config.client_id.is_empty() {
        config.client_id = load().client_id;
    }
    if config.client_id.is_empty() {
        config.client_id = paths::new_uuid();
    }
    config.client_id.clone()
}

// ── Миграции ─────────────────────────────────────────────────────────────────

static VAULT_INITIALIZED: OnceLock<bool> = OnceLock::new();

/// Тяжёлая инициализация хранилища: соль, авторазблокировка, миграция ключей.
///
/// Вызывается из фоновой задачи после показа окна. Повторные вызовы — no-op
/// (process-wide guard), при этом синхронная часть (инициализация соли и
/// авторазблокировка) выполняется до первого `await`, поэтому вызов без
/// ожидания по-прежнему синхронно открывает хранилище.
pub async fn initialize_vault_and_migrate(config: &mut AppConfig) {
    if VAULT_INITIALIZED.get().is_some() {
        return;
    }
    let _ = VAULT_INITIALIZED.set(true);

    let mut needs_resave = false;

    // 1. Соль
    if config.encryption.is_none() {
        config.encryption = Some(EncryptionInfo {
            version: 1,
            salt: paths::random_base64(16),
            check: None,
        });
        needs_resave = true;
    }

    // 2. Авторазблокировка из системного хранилища
    if let Some(encryption) = config.encryption.clone() {
        if let Some(cached) = crate::keychain::load_recovery_key() {
            match vault::unlock(&cached, &encryption.salt) {
                Ok(()) => {
                    if !vault::verify(encryption.check.as_ref(), app_encrypted_passwords()) {
                        vault::lock();
                        crate::keychain::delete_recovery_key();
                        config.cached_recovery_key = None;
                        needs_resave = true;
                    }
                }
                Err(err) => {
                    logger::warn("Config", &format!("Auto-unlock failed: {err}"));
                }
            }
        }
    }

    // 3. Миграция legacy-путей к ключам
    if migrate_private_key_paths(config) {
        needs_resave = true;
    }

    if config.encrypted_passwords.is_none() {
        config.encrypted_passwords = Some(BTreeMap::new());
        needs_resave = true;
    }

    // 4. Идентификаторы серверов
    for favorite in &mut config.favorites {
        if favorite.id.as_deref().unwrap_or("").is_empty() {
            favorite.id = Some(paths::new_uuid());
            needs_resave = true;
        }
    }

    if needs_resave {
        let snapshot = config.clone();
        if let Err(err) = save(&snapshot) {
            logger::warn("Config", &format!("Background vault init save failed: {err}"));
        }
    }
}

fn app_encrypted_passwords() -> Option<EncryptedSecret> {
    load()
        .encrypted_passwords
        .as_ref()
        .and_then(|map| map.values().next().cloned())
}

/// Миграция `privateKeyPath` → зашифрованный `privateKey`.
///
/// Идемпотентна и безопасна: путь удаляется только тогда, когда blob реально
/// расшифровывается текущим хранилищем. При ошибке путь сохраняется, файл на
/// диске не трогается.
pub fn migrate_private_key_paths(config: &mut AppConfig) -> bool {
    if !vault::is_unlocked() {
        return false;
    }

    let mut changed = false;
    for favorite in &mut config.favorites {
        let Some(path) = favorite.private_key_path.clone() else { continue };

        if let Some(secret) = favorite.private_key_secret() {
            if vault::decrypt(&secret).is_ok() {
                favorite.private_key_path = None;
                changed = true;
            }
            continue;
        }

        match std::fs::read_to_string(&path) {
            Ok(content) => {
                if !keys::is_supported_private_key_format(&content) {
                    logger::warn(
                        "Config",
                        &format!("Skipped migration of invalid private key for server {}", display_id(favorite)),
                    );
                    continue;
                }
                match vault::encrypt(&content) {
                    Ok(secret) => {
                        if vault::decrypt(&secret).as_deref() == Ok(content.as_str()) {
                            favorite.private_key = serde_json::to_value(secret).ok();
                            favorite.private_key_path = None;
                            changed = true;
                        } else {
                            favorite.private_key = None;
                        }
                    }
                    Err(err) => logger::warn(
                        "Config",
                        &format!("Failed to encrypt private key for server {}: {err}", display_id(favorite)),
                    ),
                }
            }
            Err(err) => logger::warn(
                "Config",
                &format!("Failed to migrate private key for server {}: {err}", display_id(favorite)),
            ),
        }
    }

    changed
}

fn display_id(favorite: &SshConfig) -> String {
    favorite.id.clone().unwrap_or_else(|| favorite.host.clone())
}

/// Кэш ключа восстановления принадлежит исключительно main-процессу.
///
/// Снимок конфига, который держит renderer, поля не содержит: иначе любое
/// сохранение из UI (смена темы, обновление `osPrettyName`, настройки SFTP)
/// удаляло бы кэш и приложение снова спрашивало бы ключ при следующем запуске.
pub fn preserve_cached_recovery_key(config: &mut AppConfig) {
    let current = load().cached_recovery_key;
    config.cached_recovery_key = current;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn favorite(partial: SshConfig) -> SshConfig {
        SshConfig {
            name: "server".to_owned(),
            user: "root".to_owned(),
            host: "example.com".to_owned(),
            port: 22,
            ..partial
        }
    }

    #[test]
    fn favorites_последнее_поле_конфига() {
        let json = serde_json::to_value(default_config()).expect("config serializes");
        let object = json.as_object().expect("config is object");
        let last = object.keys().last().expect("config is not empty");
        assert_eq!(last, "favorites");
    }

    #[test]
    fn пустой_client_id_заполняется_и_не_перетирается() {
        let mut config = AppConfig { client_id: String::new(), ..default_config() };
        ensure_client_id_standalone(&mut config);
        assert!(!config.client_id.is_empty(), "идентификатор должен быть создан");

        // Уже записанный идентификатор — источник правды: новый uuid его не
        // заменяет, иначе телеметрия считала бы пользователя новым.
        let generated = config.client_id.clone();
        ensure_client_id_standalone(&mut config);
        assert_eq!(config.client_id, generated, "clientId не должен перетираться");
    }

    #[test]
    fn пустой_секрет_удаляет_сохранённый() {
        // Проверяется без хранилища: пустая строка обязана удалять запись.
        let mut favorites = vec![favorite(SshConfig {
            id: Some("srv-1".to_owned()),
            password: Some(String::new()),
            ..SshConfig::default()
        })];
        let mut store = BTreeMap::new();
        store.insert(
            "srv-1".to_owned(),
            EncryptedSecret { iv: "a".into(), tag: "b".into(), data: "c".into() },
        );

        sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, false);

        assert!(!store.contains_key("srv-1"));
        assert!(favorites[0].password.is_none());
    }

    #[test]
    fn отсутствующее_поле_не_трогает_сохранённый_секрет() {
        let mut favorites = vec![favorite(SshConfig {
            id: Some("srv-1".to_owned()),
            ..SshConfig::default()
        })];
        let mut store = BTreeMap::new();
        let original = EncryptedSecret { iv: "a".into(), tag: "b".into(), data: "c".into() };
        store.insert("srv-1".to_owned(), original.clone());

        sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, true);

        assert_eq!(store.get("srv-1"), Some(&original));
    }

    #[test]
    fn настройки_восстанавливаются_при_пустых_значениях() {
        let mut config = default_config();
        config.terminal_font_name = String::new();
        config.mcp_port = 0;
        config.mcp_token = String::new();
        normalize(&mut config);
        assert_eq!(config.terminal_font_name, "JetBrains Mono");
        assert_eq!(config.mcp_port, 3000);
        assert!(!config.mcp_token.is_empty());
    }

    #[test]
    fn конфиг_без_онбординга_считается_настроенным() {
        let json = serde_json::json!({ "terminalFontName": "Old Mono", "favorites": [] });
        let mut value = json;
        value
            .as_object_mut()
            .expect("object")
            .entry("isOnboardingCompleted".to_owned())
            .or_insert(serde_json::Value::Bool(true));
        let config: AppConfig = serde_json::from_value(value).expect("config parses");
        assert!(config.is_onboarding_completed);
    }

    #[test]
    fn legacy_string_port_is_loaded_as_a_number() {
        let mut value = serde_json::to_value(default_config()).expect("default config serializes");
        value["favorites"] = serde_json::json!([{
            "id": "legacy-server",
            "name": "server",
            "user": "root",
            "host": "example.com",
            "port": "12222"
        }]);

        let config: AppConfig = serde_json::from_value(value).expect("legacy config parses");
        assert_eq!(config.favorites[0].port, 12222);
    }
}
