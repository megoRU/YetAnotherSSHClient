//! Обработчик ключей хоста и кодов возврата SSH.
//! Данные приложение читает из каналов russh.

use std::collections::HashMap;
use std::sync::Arc;

use russh::client::{DisconnectReason, Handler, Session};
use russh::keys::{HashAlg, PublicKeyOrCertificate};
use tokio::sync::Mutex;

use crate::logger;

/// Таблица кодов возврата каналов: `channel_id -> exit status`.
///
/// Их присылает сервер уже после EOF, поэтому читать их из потока канала
/// нельзя. Нужна, в частности, для `ssh-get-os-info` и распаковки архивов.
pub type ExitStatusMap = Arc<Mutex<HashMap<u32, u32>>>;

/// Ключ хоста, предъявленный сервером, от которого отказал клиент.
///
/// `check_server_key` не может сам показать UI: обработчик работает внутри
/// рукопожатия `russh` и не знает про сессии приложения. Поэтому отпечаток
/// кладётся в общий слот, а `session::connect` читает его после `UnknownKey`.
pub type OfferedKey = Arc<Mutex<Option<String>>>;

/// Обработчик клиентской сессии SSH.
pub struct ClientHandler {
    /// Общая с соединением таблица кодов возврата.
    pub exit_status: ExitStatusMap,
    /// Отпечаток, сохранённый в конфиге этого сервера.
    expected_fingerprint: Option<String>,
    /// Отпечаток, который сервер предъявил вместо сохранённого.
    offered_key: OfferedKey,
}

impl ClientHandler {
    /// `expected_fingerprint` — отпечаток из `favorites[id].fingerprint`.
    /// Возвращает обработчик, таблицу кодов возврата и слот для отпечатка.
    pub fn new(expected_fingerprint: Option<String>) -> (Self, ExitStatusMap, OfferedKey) {
        let exit_status: ExitStatusMap = Arc::new(Mutex::new(HashMap::new()));
        let offered_key: OfferedKey = Arc::new(Mutex::new(None));
        let handler = ClientHandler {
            exit_status: exit_status.clone(),
            expected_fingerprint,
            offered_key: offered_key.clone(),
        };
        (handler, exit_status, offered_key)
    }
}

/// Отпечаток ключа в формате OpenSSH: `SHA256:…`.
///
/// Формат совпадает с тем, что показывают `ssh` и `ssh-keygen`, поэтому
/// пользователь может сверить его с выводом на самом сервере. `None` означает,
/// что отпечаток вычислить не удалось: сравнивать не с чем, и ключ не должен
/// приниматься молча.
pub fn host_key_fingerprint(key: &PublicKeyOrCertificate) -> Option<String> {
    key.public_key()
        .fingerprint(HashAlg::Sha256)
        .to_string()
        .strip_prefix("SHA256:")
        .map(|digest| format!("SHA256:{digest}"))
}

/// Забирает отпечаток, из-за которого рукопожатие было прервано.
pub fn take_offered_key(offered: &OfferedKey) -> Option<String> {
    offered.try_lock().ok()?.take()
}

impl Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let Some(fingerprint) = host_key_fingerprint(server_public_key) else {
            // Отпечаток не вычислился — подтверждать нечего, а принимать
            // вслепую нельзя: это тот же случай, что и несовпадение.
            logger::warn("SSH", "Host key fingerprint could not be computed; confirmation required");
            return Ok(false);
        };

        // Совпадение с сохранённым отпечатком — единственный случай, когда ключ
        // принимается без вопроса пользователю.
        if self.expected_fingerprint.as_deref() == Some(fingerprint.as_str()) {
            return Ok(true);
        }

        // Расхождение (или сохранённого отпечатка не было вовсе): `false`
        // прерывает рукопожатие, а отпечаток уходит в слот для UI. Перезапись
        // сохранённого значения здесь не происходит — это делает реестр только
        // после явного подтверждения.
        if let Ok(mut slot) = self.offered_key.try_lock() {
            *slot = Some(fingerprint);
        }
        Ok(false)
    }

    async fn channel_close(
        &mut self,
        channel: russh::ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        crate::logger::debug("SSH", &format!("Channel {} closed", channel.number()));
        Ok(())
    }

    async fn exit_status(
        &mut self,
        channel: russh::ChannelId,
        exit_status: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Сохраняем синхронно (без `.await` по mutex), чтобы не блокировать
        // цикл обработки russh.
        if let Ok(mut guard) = self.exit_status.try_lock() {
            guard.insert(channel.number(), exit_status);
        }
        Ok(())
    }

    async fn auth_banner(&mut self, banner: &str, _session: &mut Session) -> Result<(), Self::Error> {
        crate::logger::info("SSH", &format!("Auth banner: {banner}"));
        Ok(())
    }

    async fn disconnected(&mut self, _reason: DisconnectReason<Self::Error>) -> Result<(), Self::Error> {
        Ok(())
    }
}

/// Тип ошибок russh, расширенный локализуемыми вариантами приложения.
#[derive(Debug, thiserror::Error)]
pub enum SshError {
    #[error("{0}")]
    Rus(#[from] russh::Error),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("Приватный ключ: {0}")]
    PrivateKey(#[from] crate::keys::PrivateKeyError),

    #[error("Хранилище заблокировано")]
    VaultLocked,

    #[error("Авторизация отклонена сервером")]
    AuthRejected,

    #[error("Отменено пользователем")]
    Cancelled,

    #[error("{0}")]
    Localized(String),
}

impl SshError {
    /// Текст или маркер локализации для UI.
    pub fn localized(&self) -> String {
        match self {
            SshError::PrivateKey(err) => err.localized(),
            SshError::VaultLocked => crate::i18n::t("errors.vaultLocked", &[]),
            other => other.to_string(),
        }
    }
}

/// Удобная обёртка для `Arc<SshError>` в задачах.
pub type SharedSshError = Arc<SshError>;

#[cfg(test)]
#[path = "../tests/ssh_handler.rs"]
mod tests;
