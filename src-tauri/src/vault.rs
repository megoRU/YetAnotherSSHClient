//! Хранилище секретов — порт `electron/src/vault.ts`.
//!
//! Алгоритм не менялся: мастер-ключ = `scrypt(recoveryKey, salt, N=2^17, r=8, p=1)`
//! → 32 байта, шифрование — AES-256-GCM со случайным 12-байтным IV.
//! Совместимость нужна для переноса данных между Electron- и Tauri-сборками:
//! один и тот же `~/.minissh_config.json` должен открываться в обеих.

use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::consts::U12;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

use crate::config::EncryptedSecret;

const KEY_LEN: usize = 32;
const IV_LEN: usize = 12;

/// scrypt-параметры, применённые в Electron-версии (значения по умолчанию
/// `scryptSync` из Node.js при длине ключа 32).
const LOG_N: u8 = 14;
const R: u32 = 8;
const P: u32 = 1;

const LOCKED: &str = "VAULT_LOCKED";

fn master_key() -> &'static Mutex<Option<[u8; KEY_LEN]>> {
    static KEY: OnceLock<Mutex<Option<[u8; KEY_LEN]>>> = OnceLock::new();
    KEY.get_or_init(|| Mutex::new(None))
}

/// Выводит мастер-ключ из ключа восстановления и соли.
pub fn unlock(recovery_key_b64: &str, salt_b64: &str) -> Result<(), String> {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    let recovery = STANDARD
        .decode(recovery_key_b64.trim())
        .map_err(|_| "Некорректный ключ восстановления".to_owned())?;
    let salt = STANDARD
        .decode(salt_b64.trim())
        .map_err(|_| "Некорректная соль хранилища".to_owned())?;

    let params = scrypt::Params::new(LOG_N, R, P).map_err(|err| err.to_string())?;
    let mut derived = [0u8; KEY_LEN];
    scrypt::scrypt(&recovery, &salt, &params, &mut derived).map_err(|err| err.to_string())?;

    let mut guard = master_key().lock().map_err(|_| LOCKED.to_owned())?;
    if let Some(previous) = guard.as_mut() {
        previous.fill(0);
    }
    *guard = Some(derived);
    Ok(())
}

pub fn is_unlocked() -> bool {
    master_key()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

/// Сбрасывает мастер-ключ, затирая его в памяти.
pub fn lock() {
    if let Ok(mut guard) = master_key().lock() {
        if let Some(previous) = guard.as_mut() {
            previous.fill(0);
        }
        *guard = None;
    }
}

fn current_key() -> Result<[u8; KEY_LEN], String> {
    let guard = master_key().lock().map_err(|_| LOCKED.to_owned())?;
    guard.ok_or_else(|| LOCKED.to_owned())
}

fn cipher() -> Result<Aes256Gcm, String> {
    let key = current_key()?;
    <Aes256Gcm as KeyInit>::new_from_slice(&key).map_err(|err| err.to_string())
}

fn nonce_bytes() -> Result<[u8; IV_LEN], String> {
    let mut bytes = [0u8; IV_LEN];
    getrandom::fill(&mut bytes).map_err(|err| err.to_string())?;
    Ok(bytes)
}

fn to_nonce(raw: &[u8; IV_LEN]) -> Result<Nonce<U12>, String> {
    Nonce::<U12>::try_from(raw.as_slice()).map_err(|err| err.to_string())
}

/// Шифрует строку. Формат полностью совпадает с Node-версией
/// (`iv`/`tag`/`data` в base64).
pub fn encrypt(plaintext: &str) -> Result<EncryptedSecret, String> {
    let cipher = cipher()?;
    let raw = nonce_bytes()?;
    let nonce = to_nonce(&raw)?;

    // `Aead::encrypt` возвращает ciphertext || tag — так же, как в Node.
    let sealed = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| "Ошибка шифрования".to_owned())?;

    if sealed.len() < 16 {
        return Err("Некорректный результат шифрования".to_owned());
    }
    let (data, tag) = sealed.split_at(sealed.len() - 16);

    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    Ok(EncryptedSecret {
        iv: STANDARD.encode(raw),
        tag: STANDARD.encode(tag),
        data: STANDARD.encode(data),
    })
}

/// Расшифровывает blob. Любая ошибка (закрытое хранилище, подмена данных,
/// чужой ключ) возвращается как `Err` — вызывающий код сам решает, что показать.
pub fn decrypt(secret: &EncryptedSecret) -> Result<String, String> {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    let cipher = cipher()?;

    let iv = STANDARD.decode(&secret.iv).map_err(|_| "Некорректный IV".to_owned())?;
    let tag = STANDARD.decode(&secret.tag).map_err(|_| "Некорректный тег".to_owned())?;
    let data = STANDARD.decode(&secret.data).map_err(|_| "Некорректные данные".to_owned())?;

    if iv.len() != IV_LEN {
        return Err("Некорректная длина IV".to_owned());
    }
    let nonce = to_nonce(&iv)?;

    let mut sealed = data;
    sealed.extend_from_slice(&tag);

    let plain = cipher
        .decrypt(&nonce, sealed.as_ref())
        .map_err(|_| "Расшифровка не удалась".to_owned())?;

    String::from_utf8(plain).map_err(|_| "Расшифрованные данные не являются UTF-8".to_owned())
}

/// Проверяет, что открытое хранилище действительно соответствует соли и
/// сохранённым данным (аналог `YASSH_VAULT_VERIFY` в Electron-версии).
///
/// `check` — эталонный blob; если его нет, берётся первый сохранённый пароль.
pub fn verify(check: Option<&EncryptedSecret>, sample: Option<EncryptedSecret>) -> bool {
    if let Some(check) = check {
        return decrypt(check).map(|value| value == "YASSH_VAULT_VERIFY").unwrap_or(false);
    }
    match sample {
        Some(secret) => decrypt(&secret).is_ok(),
        // Ничего нечем проверять: хранилище только что инициализировано.
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_key() -> (String, String) {
        (
            crate::paths::random_base64(32),
            crate::paths::random_base64(16),
        )
    }

    #[test]
    fn round_trip_и_уникальность_iv() {
        let (key, salt) = fresh_key();
        unlock(&key, &salt).expect("unlock");

        let secret = encrypt("секрет").expect("encrypt");
        assert_eq!(decrypt(&secret).expect("decrypt"), "секрет");

        let again = encrypt("секрет").expect("encrypt");
        assert_ne!(secret.iv, again.iv);
        assert_eq!(decrypt(&again).expect("decrypt"), "секрет");
    }

    #[test]
    fn закрытое_хранилище_отклоняет_операции() {
        let (key, salt) = fresh_key();
        unlock(&key, &salt).expect("unlock");
        let secret = encrypt("секрет").expect("encrypt");
        lock();
        assert!(!is_unlocked());
        assert_eq!(encrypt("x").unwrap_err(), LOCKED);
        assert_eq!(decrypt(&secret).unwrap_err(), LOCKED);
    }

    #[test]
    fn подмена_данных_обнаруживается() {
        let (key, salt) = fresh_key();
        unlock(&key, &salt).expect("unlock");
        let secret = encrypt("секрет").expect("encrypt");

        let mut tampered = secret.clone();
        tampered.tag = crate::paths::random_base64(16);
        assert!(decrypt(&tampered).is_err());
    }

    #[test]
    fn чужой_ключ_не_расшифровывает() {
        let (key, salt) = fresh_key();
        let (other_key, _) = fresh_key();

        unlock(&key, &salt).expect("unlock");
        let secret = encrypt("секрет").expect("encrypt");

        unlock(&other_key, &salt).expect("unlock");
        assert!(decrypt(&secret).is_err());
    }
}
