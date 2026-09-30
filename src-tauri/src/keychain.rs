//! Системное хранилище для кэша ключа восстановления.
//!
//! Electron использовал `safeStorage` (DPAPI / Keychain / libsecret).
//! В Tauri своего аналога нет, поэтому ключ кладётся в системное хранилище
//! учётных данных через `keyring`:
//!
//! * Windows — Credential Manager;
//! * macOS — Keychain;
//! * Linux — Secret Service (тот же backend, что и у Electron).
//!
//! Модуль «мягко деградирует»: если хранилище недоступно (нет secret service,
//! сборка с `--no-default-features`), функции возвращают `false`/`None`, и
//! приложение просто просит ключ при каждом запуске — ровно то поведение,
//! которое было у Electron при недоступном `safeStorage`.
//!
//! Сам ключ **никогда** не пишется в `AppConfig`: поле `cachedRecoveryKey`
//! хранит только признак «ключ есть в системном хранилище».

use crate::paths;

const CACHE_MARKER: &str = "keychain";

/// Есть ли в системном хранилище ключ восстановления.
pub fn has_recovery_key() -> bool {
    load_recovery_key().is_some()
}

#[cfg(feature = "keychain")]
fn entry() -> Option<keyring::Entry> {
    match keyring::Entry::new(paths::KEYCHAIN_SERVICE, paths::KEYCHAIN_USER) {
        Ok(entry) => Some(entry),
        Err(err) => {
            crate::logger::warn("Vault", &format!("Keychain entry unavailable: {err}"));
            None
        }
    }
}

#[cfg(feature = "keychain")]
pub fn load_recovery_key() -> Option<String> {
    let entry = entry()?;
    match entry.get_password() {
        Ok(value) if !value.is_empty() && value != CACHE_MARKER => Some(value),
        Ok(_) => None,
        Err(err) => {
            crate::logger::debug("Vault", &format!("Keychain read failed: {err}"));
            None
        }
    }
}

#[cfg(feature = "keychain")]
pub fn store_recovery_key(recovery_key: &str) -> bool {
    let Some(entry) = entry() else { return false };
    match entry.set_password(recovery_key) {
        Ok(()) => true,
        Err(err) => {
            crate::logger::warn("Vault", &format!("Keychain write failed: {err}"));
            false
        }
    }
}

#[cfg(feature = "keychain")]
pub fn delete_recovery_key() -> bool {
    let Some(entry) = entry() else { return false };
    match entry.delete_credential() {
        Ok(()) => true,
        Err(err) => {
            crate::logger::debug("Vault", &format!("Keychain delete failed: {err}"));
            false
        }
    }
}

#[cfg(not(feature = "keychain"))]
pub fn load_recovery_key() -> Option<String> {
    crate::logger::debug("Vault", "Keychain disabled at build time; recovery key must be entered manually");
    None
}

#[cfg(not(feature = "keychain"))]
pub fn store_recovery_key(_recovery_key: &str) -> bool {
    false
}

#[cfg(not(feature = "keychain"))]
pub fn delete_recovery_key() -> bool {
    false
}

/// Значение, которое кладём в `AppConfig.cachedRecoveryKey`.
///
/// Это маркер, а не сам ключ: так поле сохраняет смысл «кэш есть», но не
/// раскрывает секрет тому, кто прочитал файл конфига.
pub const fn cache_marker() -> &'static str {
    CACHE_MARKER
}

/// Записывает ключ в системное хранилище и ставит маркер в конфиге.
pub fn cache_recovery_key(recovery_key: &str) -> bool {
    if store_recovery_key(recovery_key) {
        crate::logger::info("Vault", "Recovery key cached in system credential store");
        true
    } else {
        false
    }
}

/// Убирает ключ из системного хранилища.
pub fn clear_cached_recovery_key() {
    delete_recovery_key();
}

#[cfg(test)]
#[path = "tests/keychain.rs"]
mod tests;
