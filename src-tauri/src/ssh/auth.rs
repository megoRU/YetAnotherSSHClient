//! Выбор способа авторизации — порт `electron/src/auth-credentials.ts`.
//!
//! Метод выбирается строго: `key` → только ключ (фолбэка на пароль нет),
//! `password` → только пароль. Данные, введённые в текущей сессии, имеют
//! приоритет над сохранёнными: сервер запросил пароль, значит ключ не подошёл.

use std::sync::Arc;

use russh::keys::HashAlg;
use russh::keys::PrivateKey;

use crate::config::{self, EncryptedSecret, SshConfig};
use crate::keys::{self, PrivateKeyError, PrivateKeyFailure};

/// Данные, введённые пользователем в текущей вкладке.
#[derive(Debug, Clone, Default)]
pub struct SessionAuth {
    /// Пароль, введённый в ответ на запрос сервера.
    pub password: Option<String>,
    /// Парольная фраза зашифрованного приватного ключа.
    pub key_passphrase: Option<String>,
    /// Приватный ключ, введённый пользователем вместо пароля.
    pub private_key: Option<EncryptedSecret>,
}

/// Что передать в `ssh2`-эквивалент авторизации.
#[derive(Debug, Clone)]
pub enum AuthPlan {
    /// Пароль (возможно, пустой — тогда сервер сам запросит ввод).
    Password(Option<String>),
    /// Приватный ключ; `hash_alg` выбирается по возможностям сервера.
    Key {
        key: Arc<PrivateKey>,
        hash_alg: Option<Option<HashAlg>>,
    },
}

/// Логин обязателен: без него сервер не пустит, поэтому подключение не
/// начинается до его ввода. Пароль запрашивает сам сервер.
pub fn is_login_required(config: &SshConfig) -> bool {
    config.user.trim().is_empty()
}

/// Готовит план авторизации для подключения.
///
/// `Err` с `PrivateKeyFailure::Passphrase` означает «нужно спросить у
/// пользователя парольную фразу» — вызывающий код переспрашивает и повторяет
/// попытку (ровно как в Electron-версии).
pub fn build_auth_plan(config: &SshConfig, session: &SessionAuth) -> Result<AuthPlan, PrivateKeyError> {
    // 1. Ключ, введённый в этой сессии, важнее всего остального.
    if let Some(secret) = session.private_key.as_ref() {
        let content = keys::decrypt_session_secret(secret)?;
        return Ok(AuthPlan::Key {
            key: keys::parse_key(&content, session.key_passphrase.as_deref())?,
            hash_alg: None,
        });
    }

    // 2. Пароль из сессии применяется, даже если для сервера настроен ключ.
    if let Some(password) = session.password.as_ref() {
        return Ok(AuthPlan::Password(Some(password.clone())));
    }

    // 3. Ключевой метод авторизации.
    if config.auth_type_is_key() {
        let content = keys::resolve_private_key(config)?;
        let passphrase = session
            .key_passphrase
            .clone()
            .or_else(|| config::resolve_stored_key_passphrase(config));
        let key = keys::parse_key(&content, passphrase.as_deref())?;
        return Ok(AuthPlan::Key { key, hash_alg: None });
    }

    // 4. Парольный метод: вольт, затем открытое значение конфига.
    let password = config::resolve_password(config).map_err(|key| PrivateKeyError {
        failure: PrivateKeyFailure::Decrypt,
        message: key,
    })?;

    Ok(AuthPlan::Password(password))
}

/// Пароль, который можно отдать серверу без вопроса пользователю.
///
/// Источники в порядке модели: системное хранилище, затем вольт, затем
/// значение текущей сессии. Ошибку расшифровки не поднимаем: тогда сработает
/// обычный путь отказа авторизации (порт `tryResolveKnownPassword`).
pub fn known_password(config: &SshConfig, session: &SessionAuth) -> Option<String> {
    crate::secrets::known_password(config, session.password.clone())
}

/// Подставляет в план хеш-алгоритм для RSA, согласованный с сервером.
///
/// Для остальных типов ключей параметр игнорируется, поэтому `None` безопасен.
pub fn with_server_hash_alg(plan: AuthPlan, supported: Result<Option<Option<HashAlg>>, russh::Error>) -> AuthPlan {
    match plan {
        AuthPlan::Key { key, .. } => {
            let hash_alg = match supported {
                Ok(value) => value,
                Err(_) => None,
            };
            AuthPlan::Key { key, hash_alg }
        }
        other => other,
    }
}

#[cfg(test)]
#[path = "../tests/ssh_auth.rs"]
mod tests;
