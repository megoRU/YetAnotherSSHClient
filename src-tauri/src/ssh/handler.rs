//! Реализация `russh::client::Handler` с пробросом событий в приложение.
//!
//! Сервер присылает данные в любой момент сессии, поэтому обработчик держит
//! собственный канал сообщений и таблицу кодов возврата. Ничего из этого не
//! попадает в UI напрямую: вывод маршрутизируется через реестр сессий, который
//! знает активную вкладку и канал.

use std::collections::HashMap;
use std::sync::Arc;

use russh::client::{DisconnectReason, Handler, Session};
use russh::keys::PublicKeyOrCertificate;
use tokio::sync::{mpsc, Mutex};

/// Событие, пришедшее от сервера в контексте соединения.
#[derive(Debug)]
pub enum HandlerEvent {
    /// Данные канала `channel_id` (в поток попадает только stdout; stderr
    /// разбирается отдельно, как и в Electron-версии, где `stderr` в терминал
    /// не подмешивался).
    Data { channel_id: u32, data: Vec<u8> },
    /// Соединение разорвано сервером или сетью.
    Disconnected(String),
}

/// Таблица кодов возврата каналов: `channel_id -> exit status`.
///
/// Их присылает сервер уже после EOF, поэтому читать их из потока канала
/// нельзя. Нужна, в частности, для `ssh-get-os-info` и распаковки архивов.
pub type ExitStatusMap = Arc<Mutex<HashMap<u32, u32>>>;

/// Обработчик клиентской сессии SSH.
pub struct ClientHandler {
    /// Идентификатор сессии (совпадает с `id` вкладки на frontend).
    pub session_id: String,
    /// События, которые надо маршрутизировать в реестр сессий.
    pub events: mpsc::UnboundedSender<HandlerEvent>,
    /// Общая с соединением таблица кодов возврата.
    pub exit_status: ExitStatusMap,
}

impl ClientHandler {
    pub fn new(session_id: String, events: mpsc::UnboundedSender<HandlerEvent>) -> (Self, ExitStatusMap) {
        let exit_status: ExitStatusMap = Arc::new(Mutex::new(HashMap::new()));
        let handler = ClientHandler {
            session_id,
            events,
            exit_status: exit_status.clone(),
        };
        (handler, exit_status)
    }

    fn send(&self, event: HandlerEvent) {
        // Канал закрыт ⇒ сессия уже удалена из реестра, событие некуда девать.
        let _ = self.events.send(event);
    }
}

impl Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // Поведение совпадает с Electron-версией (`hostVerifier` не задан):
        // ключ хоста не проверяется и не кэшируется, как и раньше.
        Ok(true)
    }

    async fn data(
        &mut self,
        channel: russh::ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.send(HandlerEvent::Data {
            channel_id: channel.number(),
            data: data.to_vec(),
        });
        Ok(())
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

    async fn disconnected(&mut self, reason: DisconnectReason<Self::Error>) -> Result<(), Self::Error> {
        let text = match reason {
            DisconnectReason::Error(err) => format!("error: {err}"),
            other => format!("{other:?}"),
        };
        self.send(HandlerEvent::Disconnected(text));
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
    /// Локализованный текст для UI.
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
