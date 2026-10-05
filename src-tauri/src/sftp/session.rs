//! SFTP-сессия и кэш каналов — порт `SftpConnection.ts` и
//! `SftpTransferManager.ts`.
//!
//! Каждая вкладка SFTP держит собственное SSH-соединение (в Electron-версии
//! для этого тоже заводился отдельный `ssh2` клиент) и один «сессионный» SFTP-канал
//! для файловых операций. Для каждого трансфера открывается **дополнительный**
//! канал поверх того же соединения — поэтому отмена отдельной передачи не
//! затрагивает остальные передачи той же вкладки.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use russh_sftp::client::error as sftp_error;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::config::SshConfig;
use crate::logger;
use crate::ssh::session::{self, ConnectOutcome, Connection};
use crate::ssh::SshError;

/// Таймаут открытия SFTP-подсистемы.
///
/// Сервер может не ответить на запрос SFTP (например, подсистема отключена) —
/// без таймаута операция висела бы навсегда.
const SUBSYSTEM_TIMEOUT: Duration = Duration::from_secs(30);
/// Таймаут всего этапа SSH handshake и авторизации для SFTP.
const SSH_CONNECT_TIMEOUT: Duration = Duration::from_secs(45);

/// Состояние жизненного цикла трансфера (порт `TransferLifecycleState`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferState {
    Active,
    Completing,
    Cancelling,
}

/// Активный трансфер: собственный SFTP-канал + временный путь.
pub struct Transfer {
    pub session_id: String,
    pub state: TransferState,
    /// Канал трансфера: он же нужен для удаления временного пути при отмене.
    pub sftp: Arc<SftpSession>,
    pub temp_remote_path: Option<String>,
}

/// Сессия SFTP-вкладки.
#[derive(Clone)]
pub struct SftpSessionEntry {
    pub connection: Connection,
    pub config: SshConfig,
    /// Сессионный канал для readdir/mkdir/rm/…
    pub sftp: Arc<SftpSession>,
}

/// Реестр SFTP-вкладок и трансферов.
#[derive(Default)]
pub struct SftpManager {
    sessions: Mutex<HashMap<String, SftpSessionEntry>>,
    /// Реестр трансферов под `Arc`: на него ссылается закладка активности,
    /// которую держат задачи передачи файлов.
    transfers: Arc<Mutex<HashMap<String, Transfer>>>,
    /// Эпохи подключения: `close_session` увеличивает эпоху, и in-flight
    /// подключение, открытое до закрытия, не кэшируется (порядок как в воркере).
    epochs: Mutex<HashMap<String, u64>>,
    /// Сглаживатель прогресса: один на приложение, пачки формируются по сессии.
    pub batcher: Arc<crate::sftp::progress::ProgressBatcher>,
}

impl SftpManager {
    pub fn new() -> Self {
        SftpManager {
            sessions: Mutex::new(HashMap::new()),
            transfers: Arc::new(Mutex::new(HashMap::new())),
            epochs: Mutex::new(HashMap::new()),
            batcher: Arc::new(crate::sftp::progress::ProgressBatcher::new()),
        }
    }

    /// Подключает вкладку SFTP и сообщает статус `ready`.
    ///
    /// Повторный вызов для того же `id` переиспользует живое соединение —
    /// ровно как ветка `Reusing existing SSH client` в `SftpConnection.ts`.
    ///
    /// Рекурсия по отпечатку ключа хоста (подтверждение → повторное подключение)
    /// требует явного `Box`: без него future не помещается в свой же размер.
    #[allow(clippy::manual_async_fn)]
    pub fn connect<'a>(
        &'a self,
        app: &'a AppHandle,
        id: &'a str,
        config: SshConfig,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(self.connect_inner(app, id, config, true))
    }

    /// Спрашивает отпечаток и ждёт решения пользователя.
    ///
    /// Возвращает подтверждённый отпечаток — вызывающий продолжает с ним то же
    /// подключение. `None` — отказ или закрытие вкладки во время ожидания.
    async fn await_fingerprint(
        &self,
        app: &AppHandle,
        id: &str,
        config: &SshConfig,
        fingerprint: String,
    ) -> Option<String> {
        let state = app.try_state::<crate::state::AppState>()?;
        let decision = state
            .terminals
            .fingerprints
            .request(
                app,
                id,
                config.id.as_deref(),
                fingerprint,
                config.fingerprint.clone(),
            )
            .await?;

        match decision.await {
            Ok(crate::ssh::FingerprintOutcome::Accept { fingerprint, saved }) => {
                if !saved {
                    logger::info(
                        "SFTP",
                        &format!("Fingerprint not persisted for {id}: server is not in favorites"),
                    );
                }
                Some(fingerprint)
            }
            Ok(crate::ssh::FingerprintOutcome::Reject) | Err(_) => None,
        }
    }

    /// `ask_fingerprint` запрещает повторный запрос отпечатка в той же попытке:
    /// без него несохраняемый отпечаток (например, сервер вне избранного)
    /// заставил бы подключение спрашивать бесконечно.
    async fn connect_inner(&self, app: &AppHandle, id: &str, config: SshConfig, ask_fingerprint: bool) {
        let epoch = self.bump_epoch(id).await;
        logger::info("SFTP", &format!("Connecting to {}:{} (ID: {id})", config.host, config.effective_port()));

        if let Some(existing) = self.sessions(id).await {
            if !existing.connection.is_closed() {
                match open_subsystem(&existing.connection).await {
                    Ok(sftp) => {
                        if self.current_epoch(id).await != epoch {
                            let _ = sftp.close().await;
                            return;
                        }
                        self.sessions
                            .lock()
                            .await
                            .insert(id.to_owned(), SftpSessionEntry { sftp: Arc::new(sftp), ..existing });
                        emit_status(app, id, SftpStatusKind::Ready);
                        return;
                    }
                    Err(err) => {
                        if self.current_epoch(id).await != epoch {
                            return;
                        }
                        let message = err.to_string();
                        self.emit_error(app, id, SftpErrorKind::SshError, Some(&message));
                        return;
                    }
                }
            }
        }

        // Эпоха уже увеличена выше. Повторный bump здесь делал бы каждое
        // новое подключение устаревшим ещё до открытия SFTP-подсистемы.
        self.close_session_channels_inner(id).await;

        logger::info("SFTP", &format!("Starting SSH handshake/authentication (ID: {id})"));
        let (events, _receiver) = tokio::sync::mpsc::unbounded_channel();
        let outcome = match tokio::time::timeout(
            SSH_CONNECT_TIMEOUT,
            session::connect(&config, &crate::ssh::SessionAuth::default(), id, events),
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(_) => {
                logger::warn("SFTP", &format!("SSH handshake timed out for ID: {id}"));
                self.emit_error(app, id, SftpErrorKind::TcpTimeout, None);
                return;
            }
        };
        let connection = match outcome {
            Ok(ConnectOutcome::Ready(connection)) => {
                logger::info("SFTP", &format!("SSH authentication completed (ID: {id})"));
                connection
            }
            Ok(ConnectOutcome::NeedsSecret { .. }) => {
                logger::warn("SFTP", &format!("Server requested interactive credentials (ID: {id})"));
                self.emit_error(app, id, SftpErrorKind::AuthFailure, None);
                return;
            }
            // Ключ хоста не подтверждён: спрашиваем пользователя и продолжаем
            // то же подключение, а не заставляем повторять его вручную.
            Ok(ConnectOutcome::NeedsFingerprint { fingerprint }) => {
                if !ask_fingerprint {
                    self.emit_error(
                        app,
                        id,
                        SftpErrorKind::SshError,
                        Some(&crate::i18n::t("terminal.fingerprintRequired", &[])),
                    );
                    return;
                }
                logger::info("SFTP", &format!("Host fingerprint confirmation required (ID: {id})"));
                match self.await_fingerprint(app, id, &config, fingerprint).await {
                    // Отпечаток подтверждён. Продолжаем подключение **с ним**:
                    // раньше здесь уходил исходный конфиг, где отпечатка ещё не
                    // было, и сервер тут же запрашивал ключ снова.
                    //
                    // Второй раз не спрашиваем — иначе сервер вне избранного
                    // (сохранять некуда) заставил бы спрашивать бесконечно.
                    Some(fingerprint) => {
                        let mut confirmed = config.clone();
                        confirmed.fingerprint = Some(fingerprint);
                        Box::pin(self.connect_inner(app, id, confirmed, false)).await;
                        return;
                    }
                    None => {
                        self.emit_error(
                            app,
                            id,
                            SftpErrorKind::SshError,
                            Some(&crate::i18n::t("terminal.fingerprintRejected", &[])),
                        );
                        return;
                    }
                }
            }
            Err(err) => {
                let kind = if matches!(err, SshError::AuthRejected) {
                    SftpErrorKind::AuthFailure
                } else {
                    SftpErrorKind::SshError
                };
                self.emit_error(app, id, kind, Some(&err.localized()));
                return;
            }
        };

        // Пока устанавливалось соединение, вкладку могли закрыть — такое
        // подключение не должно пережить собственное закрытие.
        if self.current_epoch(id).await != epoch {
            logger::info("SFTP", &format!("Discarding stale connection before subsystem open (ID: {id})"));
            connection.disconnect("session closed during connect").await;
            return;
        }

        logger::info("SFTP", &format!("Opening SFTP subsystem (ID: {id})"));
        let sftp = match open_subsystem(&connection).await {
            Ok(sftp) => {
                logger::info("SFTP", &format!("SFTP subsystem opened (ID: {id})"));
                Arc::new(sftp)
            }
            Err(err) => {
                connection.disconnect("sftp subsystem unavailable").await;
                self.emit_error(app, id, SftpErrorKind::SshError, Some(&err.to_string()));
                return;
            }
        };

        if self.current_epoch(id).await != epoch {
            connection.disconnect("session closed during sftp setup").await;
            return;
        }

        logger::info("SFTP", &format!("SFTP session ready for ID: {id}"));
        self.sessions.lock().await.insert(
            id.to_owned(),
            SftpSessionEntry {
                connection,
                config,
                sftp,
            },
        );
        emit_status(app, id, SftpStatusKind::Ready);
    }

    /// Закладка активности трансфера для `TransferContext::is_active`.
    ///
    /// Отдельный `Arc` вместо опроса реестра: проверка идёт на каждом чанке
    /// передачи, и блокировка реестра 16 раз в секунду на файл создавала бы
    /// лишний contention с отменой.
    pub fn activity_flag(&self, transfer_id: &str) -> Arc<dyn Fn() -> bool + Send + Sync> {
        let transfers = self.transfers.clone();
        let transfer_id = transfer_id.to_owned();
        Arc::new(move || match transfers.try_lock() {
            Ok(guard) => guard
                .get(&transfer_id)
                .map(|transfer| transfer.state == TransferState::Active)
                .unwrap_or(true),
            Err(_) => true,
        })
    }

    /// Сессионный канал вкладки (кэшированный).
    pub async fn session(&self, id: &str) -> Option<SftpSessionEntry> {
        self.sessions.lock().await.get(id).cloned()
    }

    /// Открывает дополнительный канал для отдельного трансфера.
    pub async fn transfer_channel(&self, id: &str) -> Result<Arc<SftpSession>, String> {
        let entry = self
            .sessions
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| crate::i18n::t("errors.sshClientNotFound", &[]))?;
        let sftp = open_subsystem(&entry.connection)
            .await
            .map_err(|err| err.to_string())?;
        Ok(Arc::new(sftp))
    }

    /// Регистрирует трансфер: он получает собственный канал и временный путь.
    pub async fn register_transfer(
        &self,
        session_id: &str,
        transfer_id: &str,
        sftp: Arc<SftpSession>,
        temp_remote_path: Option<String>,
    ) {
        self.transfers.lock().await.insert(
            transfer_id.to_owned(),
            Transfer {
                session_id: session_id.to_owned(),
                state: TransferState::Active,
                sftp,
                temp_remote_path,
            },
        );
    }

    pub async fn unregister_transfer(&self, transfer_id: &str) {
        self.transfers.lock().await.remove(transfer_id);
    }

    pub async fn is_transfer_active(&self, transfer_id: &str) -> bool {
        self.transfers
            .lock()
            .await
            .get(transfer_id)
            .map(|transfer| transfer.state == TransferState::Active)
            .unwrap_or(false)
    }

    /// `ACTIVE -> COMPLETING`: только один вызов может выиграть гонку.
    ///
    /// Если отмена уже началась, промоут временного пути не выполняется — иначе
    /// отменённая загрузка всё же заменила бы целевой файл.
    pub async fn try_start_completing(&self, transfer_id: &str) -> bool {
        let mut transfers = self.transfers.lock().await;
        match transfers.get_mut(transfer_id) {
            Some(transfer) if transfer.state == TransferState::Active => {
                transfer.state = TransferState::Completing;
                true
            }
            _ => false,
        }
    }

    /// Отмена трансфера: гасит прогресс, запрещает промоут, чистит temp-путь.
    ///
    /// Temp-файл удаляется **тем же** каналом, которым он был создан: сессионный
    /// канал может указывать на другую вкладку и удалил бы чужой файл.
    pub async fn cancel_transfer(
        &self,
        app: &AppHandle,
        session_id: &str,
        transfer_id: Option<&str>,
    ) -> bool {
        let Some(transfer_id) = transfer_id else {
            // Отмена без идентификатора: закрываем канал всей вкладки.
            self.close_session_channels(session_id).await;
            return true;
        };

        let (sftp, temp_remote_path) = {
            let mut transfers = self.transfers.lock().await;
            let Some(transfer) = transfers.get_mut(transfer_id) else { return false };
            if transfer.state != TransferState::Active {
                return false;
            }
            transfer.state = TransferState::Cancelling;
            (transfer.sftp.clone(), transfer.temp_remote_path.clone())
        };

        if let Some(temp) = temp_remote_path {
            crate::sftp::utils::remove_remote_path(&sftp, &temp).await;
        } else {
            // Для скачивания нет удалённого temp-файла: закрываем выделенный
            // канал, чтобы отмена прервала и чтение, ожидающее ответа сервера.
            let _ = sftp.close().await;
        }

        let _ = app;
        true
    }

    /// Закрытие вкладки: останавливает все её трансферы и соединение.
    pub async fn close_session(&self, app: &AppHandle, id: &str) {
        self.close_session_channels(id).await;
        let _ = app;
    }

    async fn close_session_channels(&self, id: &str) {
        self.bump_epoch(id).await;
        self.close_session_channels_inner(id).await;
    }

    async fn close_session_channels_inner(&self, id: &str) {
        let transfers: Vec<String> = {
            let guard = self.transfers.lock().await;
            guard
                .iter()
                .filter(|(_, transfer)| transfer.session_id == id)
                .map(|(transfer_id, _)| transfer_id.clone())
                .collect()
        };
        for transfer_id in transfers {
            let entry = self.transfers.lock().await.remove(&transfer_id);
            if let Some(entry) = entry {
                if let Some(temp) = entry.temp_remote_path.as_deref() {
                    // Удаляем temp ПОКА жив канал: удаление — это серия
                    // SSH-запросов, и закрытый канал их не выполнит.
                    crate::sftp::utils::remove_remote_path(&entry.sftp, temp).await;
                }
                let _ = entry.sftp.close().await;
            }
        }

        if let Some(entry) = self.sessions.lock().await.remove(id) {
            let _ = entry.sftp.close().await;
            entry.connection.disconnect("sftp session closed").await;
        }
    }

    /// Закрывает все сессии (выход из приложения).
    pub async fn close_all(&self) {
        let ids: Vec<String> = self.sessions.lock().await.keys().cloned().collect();
        for id in ids {
            self.close_session_channels(&id).await;
        }
        self.transfers.lock().await.clear();
    }

    /// Сообщает об окончании SSH-соединения (`connection-ended` / `-closed`).
    pub async fn notify_connection_closed(&self, app: &AppHandle, id: &str, kind: SftpStatusKind) {
        self.close_session_channels(id).await;
        emit_status(app, id, kind);
    }

    pub fn emit_error(&self, app: &AppHandle, id: &str, kind: SftpErrorKind, message: Option<&str>) {
        let event = SftpErrorEvent {
            kind: kind.as_str().to_owned(),
            message: message.map(|value| value.to_owned()),
        };
        if let Some(message) = event.message.as_deref() {
            logger::error("SFTP", &format!("SFTP error for ID {id}: {message}"));
        } else {
            logger::error("SFTP", &format!("SFTP error for ID {id}: {}", event.kind));
        }
        let _ = app.emit(&format!("sftp-error-{id}"), event);
    }

    async fn sessions(&self, id: &str) -> Option<SftpSessionEntry> {
        self.sessions.lock().await.get(id).cloned()
    }

    async fn bump_epoch(&self, id: &str) -> u64 {
        let mut epochs = self.epochs.lock().await;
        let epoch = epochs.get(id).copied().unwrap_or(0);
        epochs.insert(id.to_owned(), epoch + 1);
        epoch + 1
    }

    async fn current_epoch(&self, id: &str) -> u64 {
        self.epochs.lock().await.get(id).copied().unwrap_or(0)
    }
}

/// Открывает SFTP-подсистему на соединении с таймаутом.
pub async fn open_subsystem(connection: &Connection) -> Result<SftpSession, sftp_error::Error> {
    let channel = session::open_session_channel(connection).await.map_err(sftp_transport_error)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(sftp_transport_error)?;
    match tokio::time::timeout(SUBSYSTEM_TIMEOUT, SftpSession::new(channel.into_stream())).await {
        Ok(result) => result,
        // Таймаут оставляем на уровне текста ошибки: SFTP-подсистема может быть
        // отключена на сервере, и код ответа в этом случае отсутствует.
        Err(_) => Err(sftp_error::Error::UnexpectedBehavior("SFTP subsystem timeout".to_owned())),
    }
}

/// Приводит ошибку транспорта russh к типу ошибок russh-sftp.
fn sftp_transport_error(error: impl std::fmt::Display) -> sftp_error::Error {
    sftp_error::Error::UnexpectedBehavior(error.to_string())
}

// ── События ──────────────────────────────────────────────────────────────────

/// Структурированные статусы SFTP-соединения (без привязки к локали).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SftpStatusKind {
    Ready,
    ConnectionEnded,
    ConnectionClosed,
}

/// Структурированные коды ошибок SFTP-соединения.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SftpErrorKind {
    AuthFailure,
    TcpTimeout,
    SocketError,
    SshError,
    ConfigError,
}

impl SftpErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SftpErrorKind::AuthFailure => "auth-failure",
            SftpErrorKind::TcpTimeout => "tcp-timeout",
            SftpErrorKind::SocketError => "socket-error",
            SftpErrorKind::SshError => "ssh-error",
            SftpErrorKind::ConfigError => "config-error",
        }
    }
}

#[derive(Clone, Serialize)]
pub struct SftpErrorEvent {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct SftpStatusEvent {
    pub kind: SftpStatusKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub fn emit_status(app: &AppHandle, id: &str, kind: SftpStatusKind) {
    let _ = app.emit(&format!("sftp-status-{id}"), SftpStatusEvent { kind, message: None });
}

/// Классифицирует ошибку авторизации по префиксу `AUTH_FAILURE:`.
pub fn classify_error(formatted: &str) -> SftpErrorKind {
    if formatted.starts_with("AUTH_FAILURE:") {
        SftpErrorKind::AuthFailure
    } else {
        SftpErrorKind::SshError
    }
}

#[cfg(test)]
#[path = "../tests/sftp_session.rs"]
mod tests;
