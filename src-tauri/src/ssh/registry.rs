//! Реестр SSH-сессий — порт `electron/src/ssh-manager.ts` + `ssh-auth.ts`.
//!
//! Каждой вкладке терминала соответствует запись в реестре: соединение,
//! половина канала для ввода и накопление вывода. Состояние попыток ввода
//! учётных данных живёт отдельно и удаляется при успешном подключении —
//! ровно как `clearAuthState` в Electron-версии.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use russh::ChannelWriteHalf;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::config::SshConfig;
use crate::logger;
use crate::ssh::auth::{is_login_required, SessionAuth};
use crate::ssh::session::{self, ConnectOutcome, Connection, SecretPrompt, SharedHandle};

/// Сколько раз подряд пользователь может вводить данные авторизации для
/// одного подключения (совпадает с `MAX_AUTH_ATTEMPTS`).
pub const MAX_AUTH_ATTEMPTS: u16 = 3;

/// Порция вывода, при которой событие отправляется немедленно.
const MAX_OUTPUT_BATCH_BYTES: usize = 64 * 1024;

/// Статус, означающий «в конфигурации нет логина» (`LOGIN_REQUIRED_STATUS`).
pub const LOGIN_REQUIRED_STATUS: &str = "LOGIN_REQUIRED";

/// Состояние попыток ввода учётных данных для сессии.
#[derive(Clone)]
pub struct AuthState {
    pub config: SshConfig,
    pub cols: u16,
    pub rows: u16,
    pub attempt: u16,
    pub session: SessionAuth,
    /// Соединение, оставленное открытым в ожидании ответа (keyboard-interactive).
    pub connection: Option<Connection>,
    pub prompt: Option<SecretPrompt>,
}

pub struct TerminalSession {
    pub config: SshConfig,
    pub connection: Connection,
    write_half: Option<ChannelWriteHalf<russh::client::Msg>>,
    forwards: HashMap<String, ForwardServer>,
}

#[derive(Default)]
pub struct SessionRegistry {
    terminals: Mutex<HashMap<String, TerminalSession>>,
    auth_states: Mutex<HashMap<String, AuthState>>,
    /// Соединения, созданные для перенаправления портов (в т.ч. для SFTP/MCP).
    helpers: Mutex<HashMap<String, Connection>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        SessionRegistry::default()
    }

    // ── Терминальные сессии ──────────────────────────────────────────────────

    /// Открывает сессию терминала: TCP, авторизация, PTY, shell.
    ///
    /// `attempt` — число уже выданных запросов авторизации (0 для первого
    /// подключения); `session` — данные, введённые в этой вкладке.
    pub async fn connect(
        &self,
        app: &AppHandle,
        id: &str,
        config: SshConfig,
        cols: u16,
        rows: u16,
        session: SessionAuth,
        attempt: u16,
    ) {
        // Предварительная очистка, если сессия с таким ID уже была.
        self.teardown(id).await;

        if is_login_required(&config) {
            logger::info("SSH", &format!("Login required for {}:{} (ID: {id})", config.host, config.effective_port()));
            emit_status(app, id, LOGIN_REQUIRED_STATUS);
            return;
        }

        {
            let mut states = self.auth_states.lock().await;
            states.insert(
                id.to_owned(),
                AuthState {
                    config: config.clone(),
                    cols,
                    rows,
                    attempt,
                    session: session.clone(),
                    connection: None,
                    prompt: None,
                },
            );
        }

        logger::info("SSH", &format!("Connecting to {}:{} (ID: {id})", config.host, config.effective_port()));

        match session::connect(&config, &session, id).await {
            Ok(ConnectOutcome::Ready(connection)) => {
                self.on_authenticated(app, id, config, cols, rows, connection).await;
            }
            Ok(ConnectOutcome::NeedsSecret { connection, prompt }) => {
                if !self.can_request_auth(id).await {
                    self.report_auth_exhausted(app, id, connection).await;
                    return;
                }
                self.store_pending(app, id, connection, prompt, true).await;
            }
            Err(err) => {
                let failure = auth_failure_of(&err);
                self.auth_states.lock().await.remove(id);

                if failure && self.can_request_auth(id).await {
                    self.teardown(id).await;
                    self.begin_attempt(app, id, &config, cols, rows, attempt);
                    self.request_challenge(app, id, "password", None, None, true);
                    return;
                }
                emit_error(app, id, &format_ssh_error(&err));
                self.cleanup_connection(id).await;
            }
        }
    }

    async fn on_authenticated(
        &self,
        app: &AppHandle,
        id: &str,
        config: SshConfig,
        cols: u16,
        rows: u16,
        connection: Connection,
    ) {
        self.auth_states.lock().await.remove(id);
        emit_status(app, id, &crate::i18n::t("terminal.connected", &[]));

        let mut terminals = self.terminals.lock().await;
        let mut session = TerminalSession {
            config: config.clone(),
            connection,
            write_half: None,
            forwards: HashMap::new(),
        };

        let channel = match session::open_session_channel(&session.connection).await {
            Ok(channel) => channel,
            Err(err) => {
                drop(terminals);
                emit_error(app, id, &format_ssh_error(&err));
                self.cleanup_connection(id).await;
                return;
            }
        };

        if let Err(err) = channel
            .request_pty(true, "xterm-256color", u32::from(cols), u32::from(rows), 0, 0, &[])
            .await
        {
            drop(terminals);
            emit_error(app, id, &format_ssh_error(&err.into()));
            self.cleanup_connection(id).await;
            return;
        }
        if let Err(err) = channel.request_shell(true).await {
            drop(terminals);
            emit_error(app, id, &format_ssh_error(&err.into()));
            self.cleanup_connection(id).await;
            return;
        }

        let (mut read_half, write_half) = channel.split();
        session.write_half = Some(write_half);
        terminals.insert(id.to_owned(), session);
        drop(terminals);

        spawn_reader(app.clone(), id.to_owned(), read_half);

        if let Some(commands) = config.initial_commands.clone() {
            let list: Vec<String> = commands
                .split('\n')
                .filter(|line| !line.trim().is_empty())
                .map(|line| line.to_owned())
                .collect();
            if !list.is_empty() {
                let app = app.clone();
                let id = id.to_owned();
                tauri::async_runtime::spawn(async move {
                    // Небольшая задержка, чтобы оболочка успела вывести приветствие.
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    for command in list {
                        let mut payload = command.into_bytes();
                        payload.push(b'\n');
                        emit_raw_output(&app, &id, payload);
                    }
                });
            }
        }
    }

    /// Обрабатывает ответ рендерера на запрос авторизации.
    pub async fn auth_response(&self, app: &AppHandle, payload: AuthResponse) {
        let id = payload.id.clone();
        if id.is_empty() || id.len() > 256 {
            return;
        }

        let state = self.auth_states.lock().await.get(&id).cloned();
        let Some(state) = state else { return };

        match payload.response {
            ResponseKind::Cancel => {
                logger::info("SSH", &format!("Auth input cancelled for ID: {id}"));
                self.auth_states.lock().await.remove(&id);
                self.teardown(&id).await;
                emit_status(app, &id, &crate::i18n::t("terminal.authCancelled", &[]));
            }
            ResponseKind::Secret { kind, secret } => {
                if secret.is_empty() {
                    return;
                }
                // Запрос сервера в рамках текущего соединения — отвечаем без
                // переподключения.
                if let (Some(connection), Some(prompt)) = (state.connection.as_ref(), state.prompt.as_ref()) {
                    if matches!(prompt, SecretPrompt::Password { .. }) && kind != "passphrase" {
                        let attempt = state.attempt;
                        match session::resume_with_secret(connection, &state.config, &state.session, prompt, &secret).await
                        {
                            Ok(true) => {
                                let (connection, config, cols, rows) =
                                    (connection.clone(), state.config.clone(), state.cols, state.rows);
                                self.on_authenticated(app, &id, config, cols, rows, connection).await;
                                return;
                            }
                            Ok(false) => {
                                if !self.can_request_auth(&id).await {
                                    self.report_auth_exhausted(app, &id, connection.clone()).await;
                                    return;
                                }
                                self.begin_attempt(app, &id, &state.config, state.cols, state.rows, attempt);
                                self.request_challenge(app, &id, "password", None, None, true);
                                return;
                            }
                            Err(err) => {
                                emit_error(app, &id, &format_ssh_error(&err));
                                self.cleanup_connection(&id).await;
                                return;
                            }
                        }
                    }
                }

                let next_session = match kind.as_str() {
                    "passphrase" => SessionAuth { key_passphrase: Some(secret), ..SessionAuth::default() },
                    _ => SessionAuth { password: Some(secret), ..SessionAuth::default() },
                };
                self.auth_states.lock().await.remove(&id);
                self.teardown(&id).await;
                self.connect(app, &id, state.config, state.cols, state.rows, next_session, state.attempt).await;
            }
            ResponseKind::PrivateKey { private_key } => {
                let mut key_config = state.config.clone();
                key_config.auth_type = Some("key".to_owned());
                key_config.private_key = serde_json::to_value(private_key).ok();
                key_config.private_key_path = None;
                key_config.password = None;
                key_config.key_passphrase = None;

                self.auth_states.lock().await.remove(&id);
                self.teardown(&id).await;
                self.connect(app, &id, key_config, state.cols, state.rows, SessionAuth::default(), state.attempt)
                    .await;
            }
        }
    }

    /// Отвечает серверу, запросившему данные в рамках открытого соединения.
    pub async fn input(&self, id: &str, data: &str) {
        let terminals = self.terminals.lock().await;
        let Some(session) = terminals.get(id) else { return };
        let Some(write_half) = session.write_half.as_ref() else { return };
        let _ = write_half.data_bytes(data.as_bytes().to_vec());
    }

    /// Изменение размеров PTY (`stream.setWindow(rows, cols, 0, 0)`).
    pub async fn resize(&self, id: &str, cols: u16, rows: u16) {
        let terminals = self.terminals.lock().await;
        let Some(session) = terminals.get(id) else { return };
        let Some(write_half) = session.write_half.as_ref() else { return };
        let _ = write
            .window_change(u32::from(cols), u32::from(rows), 0, 0);
    }

    /// Получение информации об ОС сервера (`cat /etc/os-release || uname -a`).
    pub async fn os_info(&self, app: &AppHandle, id: &str) {
        if id.is_empty() || id.len() > 256 {
            return;
        }
        let connection = {
            let terminals = self.terminals.lock().await;
            terminals.get(id).map(|session| session.connection.clone())
        };
        let Some(connection) = connection else { return };

        logger::info("SSH", &format!("Fetching OS info for ID: {id}"));
        match session::exec(&connection, "cat /etc/os-release || uname -a").await {
            Ok(outcome) => {
                logger::info("SSH", &format!("OS info fetched for ID: {id}"));
                let _ = app.emit(format!("ssh-os-info-{id}"), outcome.stdout);
            }
            Err(err) => logger::error("SSH", &format!("Failed to exec OS info for ID {id}: {err}")),
        }
    }

    /// Закрытие сессии рендерером.
    pub async fn close(&self, id: &str) {
        if id.is_empty() || id.len() > 256 {
            return;
        }
        self.auth_states.lock().await.remove(id);
        self.teardown(id).await;
    }

    /// Закрывает всё: вызывается при выходе из приложения.
    pub async fn cleanup_all(&self) {
        let ids: Vec<String> = self.terminals.lock().await.keys().cloned().collect();
        for id in ids {
            self.teardown(&id).await;
        }
        self.auth_states.lock().await.clear();
        self.helpers.lock().await.clear();
    }

    // ── Перенаправление портов ───────────────────────────────────────────────

    /// Поднимает локальный слушатель и пробрасывает соединения на удалённый адрес.
    pub async fn forward_start(
        &self,
        id: &str,
        config: SshConfig,
        local_address: &str,
        local_port: u16,
        remote_address: &str,
        remote_port: u16,
    ) -> Result<bool, String> {
        let outcome = session::connect(&config, &SessionAuth::default(), id).await?;
        let connection = match outcome {
            ConnectOutcome::Ready(connection) => connection,
            ConnectOutcome::NeedsSecret { .. } => {
                return Err(crate::i18n::t("terminal.authFailed", &[]));
            }
        };

        let bind: SocketAddr = format!("{local_address}:{local_port}")
            .parse()
            .map_err(|_| format!("Некорректный локальный адрес: {local_address}"))?;

        let listener = TcpListener::bind(bind)
            .await
            .map_err(|err| format!("Не удалось занять {local_address}:{local_port}: {err}"))?;

        logger::info(
            "SSH",
            &format!("Local server listening on {local_address}:{local_port} -> {remote_address}:{remote_port} (ID: {id})"),
        );

        let handle = connection.handle.clone();
        let local_address_owned = local_address.to_owned();
        let remote_address_owned = remote_address.to_owned();
        let forward_id = format!("{local_address}:{local_port}");

        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((mut stream, _peer)) = listener.accept().await else { break };
                let handle = handle.clone();
                let local_address = local_address_owned.clone();
                let remote_address = remote_address_owned.clone();
                let local_port = bind.port();

                tauri::async_runtime::spawn(async move {
                    let channel = {
                        let guard = handle.lock().await;
                        guard
                            .channel_open_forwarded_tcpip(
                                remote_address.as_str(),
                                u32::from(remote_port),
                                local_address.as_str(),
                                u32::from(local_port),
                            )
                            .await
                    };
                    let Ok(channel) = channel else {
                        let _ = stream.shutdown().await;
                        return;
                    };
                    let mut remote = channel.into_stream();
                    match tokio::io::copy_bidirectional(&mut stream, &mut remote).await {
                        Ok(_) => {}
                        Err(err) => logger::debug("SSH", &format!("Port forward ended: {err}")),
                    }
                });
            }
        });

        let mut terminals = self.terminals.lock().await;
        let entry = terminals.entry(id.to_owned()).or_insert_with(|| TerminalSession {
            config: config.clone(),
            connection: connection.clone(),
            write_half: None,
            forwards: HashMap::new(),
        });
        entry.forwards.insert(forward_id, ForwardServer {});
        drop(terminals);

        self.helpers.lock().await.insert(id.to_owned(), connection);
        Ok(true)
    }

    /// Останавливает все перенаправления портов сессии.
    pub async fn forward_stop(&self, id: &str) -> bool {
        if id.is_empty() || id.len() > 256 {
            return false;
        }
        logger::info("SSH", &format!("Stopping all port forwards for ID: {id}"));
        let mut terminals = self.terminals.lock().await;
        if let Some(session) = terminals.get_mut(id) {
            session.forwards.clear();
        }
        let removed = terminals.remove(id).is_some();
        drop(terminals);

        if let Some(connection) = self.helpers.lock().await.remove(id) {
            connection.disconnect("port forwarding stopped").await;
        }
        if removed {
            self.teardown(id).await;
        }
        true
    }

    // ── Соединения-помощники (SFTP, MCP) ──────────────────────────────────────

    /// Создаёт отдельное соединение для SFTP/MCP: Electron-версия тоже
    /// заводила для них свой `ssh2` клиент, не переиспользуя терминальный.
    pub async fn helper_connection(&self, id: &str, config: &SshConfig) -> Result<Connection, String> {
        if let Some(connection) = self.helpers.lock().await.get(id) {
            if !connection.is_closed() {
                return Ok(connection.clone());
            }
        }

        let outcome = session::connect(config, &SessionAuth::default(), id)
            .await
            .map_err(|err| err.localized())?;
        let connection = match outcome {
            ConnectOutcome::Ready(connection) => connection,
            ConnectOutcome::NeedsSecret { .. } => {
                return Err(format!("AUTH_FAILURE: {}", crate::i18n::t("terminal.authFailed", &[])));
            }
        };
        self.helpers.lock().await.insert(id.to_owned(), connection.clone());
        Ok(connection)
    }

    /// Закрывает соединение-помощник сессии.
    pub async fn drop_helper(&self, id: &str) {
        if let Some(connection) = self.helpers.lock().await.remove(id) {
            connection.disconnect("session closed").await;
        }
    }

    // ── Внутреннее ───────────────────────────────────────────────────────────

    async fn can_request_auth(&self, id: &str) -> bool {
        let states = self.auth_states.lock().await;
        states.get(id).map(|state| state.attempt < MAX_AUTH_ATTEMPTS).unwrap_or(false)
    }

    fn begin_attempt(&self, app: &AppHandle, id: &str, config: &SshConfig, cols: u16, rows: u16, attempt: u16) {
        let mut states = self.auth_states.lock().await;
        states.insert(
            id.to_owned(),
            AuthState {
                config: config.clone(),
                cols,
                rows,
                attempt: attempt + 1,
                session: SessionAuth::default(),
                connection: None,
                prompt: None,
            },
        );
    }

    /// Сохраняет соединение, ожидающее ответа пользователя, и просит ввод.
    async fn store_pending(
        &self,
        app: &AppHandle,
        id: &str,
        connection: Connection,
        prompt: SecretPrompt,
        announce: bool,
    ) {
        let kind = match prompt {
            SecretPrompt::Passphrase => "passphrase",
            SecretPrompt::Password { .. } => "password",
        };
        let (prompt_text, instructions) = match &prompt {
            SecretPrompt::Password { prompts, instructions, .. } => (prompts.first().cloned(), Some(instructions.clone())),
            SecretPrompt::Passphrase => (None, None),
        };

        {
            let mut states = self.auth_states.lock().await;
            if let Some(state) = states.get_mut(id) {
                state.connection = Some(connection);
                state.prompt = Some(prompt);
            }
        }

        if announce {
            let kind = kind.to_owned();
            self.request_challenge(app, id, &kind, prompt_text, instructions, false);
        }
    }

    fn request_challenge(
        &self,
        app: &AppHandle,
        id: &str,
        kind: &str,
        prompt: Option<String>,
        instructions: Option<String>,
        failed: bool,
    ) {
        let attempt = self
            .auth_states
            .try_lock()
            .ok()
            .and_then(|states| states.get(id).map(|state| state.attempt + 1))
            .unwrap_or(1);

        let _ = app.emit(
            format!("ssh-auth-challenge-{id}"),
            AuthChallenge {
                kind: kind.to_owned(),
                attempt,
                prompt,
                instructions,
                failed: failed.then_some(true),
            },
        );
    }

    /// Исчерпаны попытки ввода: показываем отказ авторизации и закрываем вкладку.
    async fn report_auth_exhausted(&self, app: &AppHandle, id: &str, connection: Connection) {
        self.auth_states.lock().await.remove(id);
        self.teardown(id).await;
        connection.disconnect("auth attempts exhausted").await;
        emit_error(app, id, &format!("AUTH_FAILURE: {}", crate::i18n::t("terminal.authFailed", &[])));
    }

    /// Закрывает соединение сессии, не трогая состояние авторизации.
    async fn cleanup_connection(&self, id: &str) {
        if let Some(session) = self.terminals.lock().await.remove(id) {
            session.connection.disconnect("connection closed").await;
        }
    }

    /// Полная очистка сессии: соединение, канал, перенаправления, вывод.
    async fn teardown(&self, id: &str) {
        let session = self.terminals.lock().await.remove(id);
        if let Some(session) = session {
            if let Some(write_half) = session.write_half.as_ref() {
                let _ = write_half.eof();
                let _ = write_half.close();
            }
            session.connection.disconnect("session closed").await;
        }
        self.helpers.lock().await.remove(id);
    }
}

/// Маркер активного перенаправления портов: слушатель живёт в отдельной задаче,
/// а запись нужна, чтобы `forward_stop` мог убрать её из реестра.
pub struct ForwardServer {}

// ── События ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AuthChallenge {
    pub kind: String,
    pub attempt: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<bool>,
}

/// Ответ рендерера на запрос авторизации (десериализуется вручную, чтобы
/// строгая проверка `id` осталась в реестре).
pub struct AuthResponse {
    pub id: String,
    pub response: ResponseKind,
}

pub enum ResponseKind {
    Secret { kind: String, secret: String },
    PrivateKey { private_key: crate::config::EncryptedSecret },
    Cancel,
}

pub fn emit_status(app: &AppHandle, id: &str, status: &str) {
    let _ = app.emit(format!("ssh-status-{id}"), status);
}

pub fn emit_error(app: &AppHandle, id: &str, error: &str) {
    logger::error("SSH", &format!("SSH error for ID {id}: {error}"));
    let _ = app.emit(format!("ssh-error-{id}"), error);
}

/// Отправляет порцию вывода терминала (base64, чтобы не превращать каждый байт
/// в элемент JSON-массива).
pub fn emit_raw_output(app: &AppHandle, id: &str, bytes: Vec<u8>) {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;
    let _ = app.emit(format!("ssh-output-{id}"), STANDARD.encode(bytes));
}

/// Отказ авторизации помечается префиксом `AUTH_FAILURE:` — по нему рендерер
/// показывает форму ввода (порт `formatSshError`).
pub fn format_ssh_error(err: &session::SshError) -> String {
    if auth_failure_of(err) {
        return format!("AUTH_FAILURE: {}", crate::i18n::t("terminal.authFailed", &[]));
    }
    err.localized()
}

pub fn auth_failure_of(err: &session::SshError) -> bool {
    matches!(err, session::SshError::AuthRejected)
        || err.to_string().contains("authentication")
        || err.to_string().contains("No more authentication")
}

/// Накопитель вывода терминала.
#[derive(Default)]
struct PendingOutput {
    buffer: Vec<u8>,
    /// Задача отложенной отправки уже запланирована.
    scheduled: bool,
}

/// Читает канал оболочки и отправляет вывод батчами.
///
/// Батчинг обязателен: сеть отдаёт чанки по несколько сотен байт, а на каждое
/// событие webview приходится сериализация и пробуждение IPC. Накопление до
/// 64 КиБ (или до конца тика) убирает лишние события, не меняя содержимого
/// вывода — тот же приём, что `queueOutputChunk` в `ipc-handlers.ts`.
fn spawn_reader(app: AppHandle, id: String, mut read_half: russh::ChannelReadHalf) {
    let pending: Arc<Mutex<PendingOutput>> = Arc::new(Mutex::new(PendingOutput::default()));

    tauri::async_runtime::spawn(async move {
        loop {
            let msg = read_half.wait().await;
            let chunk = match msg {
                Some(russh::ChannelMsg::Data { data }) | Some(russh::ChannelMsg::ExtendedData { data, .. }) => data,
                Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => break,
                Some(_) => continue,
            };

            let (send_now, schedule) = {
                let mut state = pending.lock().await;
                state.buffer.extend_from_slice(&chunk);
                let send_now = state.buffer.len() >= MAX_OUTPUT_BATCH_BYTES;
                let schedule = !state.scheduled && !send_now;
                if schedule {
                    state.scheduled = true;
                }
                (send_now, schedule)
            };

            if send_now {
                let payload = std::mem::take(&mut pending.lock().await.buffer);
                emit_raw_output(&app, &id, payload);
            } else if schedule {
                let app = app.clone();
                let id = id.clone();
                let pending = pending.clone();
                tauri::async_runtime::spawn(async move {
                    // Отправка на следующем тике: близко к `setImmediate`.
                    tokio::task::yield_now().await;
                    let payload = {
                        let mut state = pending.lock().await;
                        state.scheduled = false;
                        std::mem::take(&mut state.buffer)
                    };
                    if !payload.is_empty() {
                        emit_raw_output(&app, &id, payload);
                    }
                });
            }
        }

        let payload = std::mem::take(&mut pending.lock().await.buffer);
        if !payload.is_empty() {
            emit_raw_output(&app, &id, payload);
        }
        emit_status(&app, &id, &crate::i18n::t("terminal.closed", &[]));
        crate::commands::mark_session_closed(&app, &id);
    });
}

/// Открывает вспомогательное соединение для сервисов, которым нужен
/// собственный SSH-клиент (MCP, проброс портов, SFTP отдельной вкладки).
///
/// Соединение не кэшируется: вызывающий код сам управляет его временем жизни.
/// Кэширование живых соединений живёт в [`SessionRegistry::helper_connection`].
pub async fn open_helper_connection(config: &SshConfig) -> Result<Connection, String> {
    match session::connect(config, &SessionAuth::default(), "mcp").await {
        Ok(ConnectOutcome::Ready(connection)) => Ok(connection),
        Ok(ConnectOutcome::NeedsSecret { .. }) => {
            Err(format!("AUTH_FAILURE: {}", crate::i18n::t("terminal.authFailed", &[])))
        }
        Err(err) => Err(err.localized()),
    }
}

/// Открывает вспомогательное соединение для SFTP/MCP (используется в сервисах).
pub fn connection_of(session: &TerminalSession) -> SharedHandle {
    session.connection.handle.clone()
}
