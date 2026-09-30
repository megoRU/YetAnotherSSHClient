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
/// Ошибку расшифровки не поднимаем: тогда сработает обычный путь отказа
/// авторизации (порт `tryResolveKnownPassword`).
pub fn known_password(config: &SshConfig, session: &SessionAuth) -> Option<String> {
    session
        .password
        .clone()
        .or_else(|| config::resolve_password(config).ok().flatten())
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
mod tests {
    use super::*;

    /// Базовая подключка для тестов.
    ///
    /// `user` намеренно не задан жёстко: при `user: "root"` рядом с `..partial`
    /// поле из аргумента не применилось бы вовсе, и тест на пустой логин всегда
    /// получал бы «root».
    fn config(partial: SshConfig) -> SshConfig {
        SshConfig {
            name: "server".to_owned(),
            host: "example.com".to_owned(),
            port: 22,
            ..partial
        }
    }

    fn unlocked_vault() {
        let _ = crate::vault::unlock(
            &crate::paths::random_base64(32),
            &crate::paths::random_base64(16),
        );
    }

    #[test]
    fn пустой_логин_требует_ввода() {
        assert!(is_login_required(&config(SshConfig { user: String::new(), ..SshConfig::default() })));
        assert!(is_login_required(&config(SshConfig { user: "   ".to_owned(), ..SshConfig::default() })));
        assert!(!is_login_required(&config(SshConfig { user: "root".to_owned(), ..SshConfig::default() })));
    }

    #[test]
    fn без_пароля_и_ключа_план_пустой() {
        unlocked_vault();
        let plan = build_auth_plan(&config(SshConfig::default()), &SessionAuth::default()).expect("plan");
        assert!(matches!(plan, AuthPlan::Password(None)));
    }

    #[test]
    fn пароль_из_сессии_важнее_сохранённого() {
        unlocked_vault();
        let session = SessionAuth { password: Some("session".to_owned()), ..SessionAuth::default() };
        let plan = build_auth_plan(&config(SshConfig::default()), &session).expect("plan");
        match plan {
            AuthPlan::Password(value) => assert_eq!(value.as_deref(), Some("session")),
            other => panic!("unexpected plan: {other:?}"),
        }
    }

    #[test]
    fn ключевой_метод_без_ключа_даёт_missing() {
        unlocked_vault();
        let err = build_auth_plan(
            &config(SshConfig { auth_type: Some("key".to_owned()), ..SshConfig::default() }),
            &SessionAuth::default(),
        )
        .expect_err("missing");
        assert_eq!(err.failure, PrivateKeyFailure::Missing);
    }

    /// blob, который не расшифровывается: тег не сойдётся.
    fn broken_secret() -> EncryptedSecret {
        let mut secret = crate::vault::encrypt("payload").expect("encrypt");
        let mut data = secret.data.clone().into_bytes();
        // Меняем символ в середине base64: длина и алфавит остаются валидными,
        // но расшифровка провалится.
        let position = 1;
        data[position] = if data[position] == b'A' { b'B' } else { b'A' };
        secret.data = String::from_utf8(data).expect("base64");
        secret
    }

    #[test]
    fn введённый_ключ_важнее_введённого_пароля() {
        unlocked_vault();
        let session = SessionAuth {
            // Содержимое заведомо не ключ: важно, что выбрана ключевая ветка.
            // Парольная вернула бы `Ok`, поэтому любая ошибка доказывает
            // приоритет ключа.
            private_key: Some(crate::vault::encrypt("not a key").expect("encrypt")),
            password: Some("pw".to_owned()),
            ..SessionAuth::default()
        };
        let plan = build_auth_plan(
            &config(SshConfig { auth_type: Some("password".to_owned()), ..SshConfig::default() }),
            &session,
        );
        assert!(plan.is_err(), "ключ из сессии должен побеждать пароль: {plan:?}");
    }

    #[test]
    fn ошибка_расшифровки_введённого_ключа_не_становится_паролем() {
        unlocked_vault();
        let session = SessionAuth {
            private_key: Some(broken_secret()),
            password: Some("pw".to_owned()),
            ..SessionAuth::default()
        };
        let err = build_auth_plan(&config(SshConfig::default()), &session).expect_err("decrypt");
        assert_eq!(err.failure, PrivateKeyFailure::Decrypt);
    }

    #[test]
    fn неизвестный_тип_авторизации_считается_паролем() {
        unlocked_vault();
        let plan = build_auth_plan(
            &config(SshConfig { auth_type: Some("телепатия".to_owned()), ..SshConfig::default() }),
            &SessionAuth::default(),
        )
        .expect("plan");
        assert!(matches!(plan, AuthPlan::Password(None)));
    }

    #[test]
    fn известный_пароль_берётся_из_сессии_или_конфига() {
        unlocked_vault();
        assert_eq!(
            known_password(&config(SshConfig::default()), &SessionAuth::default()),
            None,
            "без ввода и без хранилища пароля спрашивать нечего"
        );

        let session = SessionAuth { password: Some("session".to_owned()), ..SessionAuth::default() };
        assert_eq!(
            known_password(&config(SshConfig::default()), &session).as_deref(),
            Some("session")
        );
    }

    #[test]
    fn смена_хеш_алгоритма_не_ломает_парольный_план() {
        let plan = AuthPlan::Password(Some("pw".to_owned()));
        match with_server_hash_alg(plan, Ok(Some(Some(HashAlg::Sha256)))) {
            AuthPlan::Password(value) => assert_eq!(value.as_deref(), Some("pw")),
            other => panic!("unexpected plan: {other:?}"),
        }
    }
}
