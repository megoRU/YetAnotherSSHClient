//! Установка SSH-соединения и работа с каналами — порт блока `openSshSession`
//! из `electron/src/ipc-handlers.ts`.
//!
//! Отличия от Electron-версии, не влияющие на поведение:
//! * `russh` не клонирует `Handle`, поэтому соединение хранится за
//!   `Arc<tokio::sync::Mutex<Handle<..>>>`; мьютекс асинхронный, поэтому guard
//!   можно держать через `.await`, а задачи остаются `Send`;
//! * рукопожатие ограничено `tokio::time::timeout` (аналог `readyTimeout`);
//! * `exec` (ОС-инфо, распаковка архивов, MCP) реализован поверх канала
//!   сессии того же соединения.
//!
//! Состояние «сервер ждёт данные пользователя» (пароль, код 2FA, парольная
//! фраза) описывается типом [`SecretPrompt`] и передаётся в реестр сессий,
//! который продолжает авторизацию по ответу из frontend.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
use tokio::sync::{mpsc, Mutex};

use crate::config::SshConfig;
use crate::ssh::auth::{self, AuthPlan, SessionAuth};
use crate::ssh::handler::{ClientHandler, ExitStatusMap, HandlerEvent};

/// Таймаут установки соединения (аналог `readyTimeout: 20000` в ssh2).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Keepalive-интервал (аналог `keepaliveInterval: 10000`).
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
/// Число keepalive без ответа до разрыва (аналог `keepaliveCountMax: 3`).
const KEEPALIVE_MAX: usize = 3;
/// Таймаут выполнения удалённой команды (MCP-команды, распаковка архивов).
pub const EXEC_TIMEOUT: Duration = Duration::from_secs(120);

pub use crate::ssh::handler::SshError;

/// Разделяемая ручка соединения: `russh` не даёт клонировать `Handle`.
pub type SharedHandle = Arc<Mutex<Handle<ClientHandler>>>;

/// Авторизованное SSH-соединение целиком.
#[derive(Clone)]
pub struct Connection {
    pub handle: SharedHandle,
    exit_status: ExitStatusMap,
}

/// Что сервер хочет получить от пользователя для продолжения авторизации.
#[derive(Debug, Clone)]
pub enum SecretPrompt {
    /// Пароль или код (keyboard-interactive).
    Password { name: String, instructions: String, prompts: Vec<String> },
    /// Парольная фраза зашифрованного приватного ключа.
    Passphrase,
}

/// Итог попытки подключения.
pub enum ConnectOutcome {
    /// Соединение авторизовано.
    Ready(Connection),
    /// Нужны данные от пользователя; соединение остаётся открытым.
    NeedsSecret { connection: Connection, prompt: SecretPrompt },
}

/// Результат выполнения удалённой команды.
#[derive(Debug, Default, Clone)]
pub struct ExecOutcome {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i64>,
}

/// Ответы на keyboard-interactive.
///
/// Введённое значение подставляется к первому приглашению, остальные получают
/// пустые ответы — это корректно для типичного сценария с одним `password`
/// prompt. Если приглашений не было, ответы не отправляются.
pub fn build_keyboard_responses(secret: &str, prompt_count: usize) -> Vec<String> {
    if prompt_count == 0 {
        return Vec::new();
    }
    let mut responses = Vec::with_capacity(prompt_count);
    responses.push(secret.to_owned());
    responses.resize(prompt_count, String::new());
    responses
}

/// Открывает TCP-соединение и выполняет авторизацию.
pub async fn connect(
    config: &SshConfig,
    session_auth: &SessionAuth,
    session_id: &str,
    events: mpsc::UnboundedSender<HandlerEvent>,
) -> Result<ConnectOutcome, SshError> {
    let client_config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60)),
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: KEEPALIVE_MAX,
        nodelay: true,
        ..client::Config::default()
    });

    let (handler, exit_status) = ClientHandler::new(session_id.to_owned(), events);
    let address = (config.host.clone(), config.effective_port());

    let handle = match tokio::time::timeout(CONNECT_TIMEOUT, client::connect(client_config, address, handler)).await
    {
        Ok(Ok(handle)) => handle,
        Ok(Err(err)) => return Err(err),
        Err(_) => return Err(SshError::Localized("Таймаут соединения (TCP)".to_owned())),
    };

    let connection = Connection {
        handle: Arc::new(Mutex::new(handle)),
        exit_status,
    };

    if authenticate(&connection, config, session_auth).await?.success() {
        return Ok(ConnectOutcome::Ready(connection));
    }

    // Отказ не означает «неверный пароль»: сервер мог сначала потребовать
    // keyboard-interactive. Пытаемся продолжить диалог и только потом решаем,
    // что показывать пользователю.
    match start_keyboard_interactive(&connection, config, session_auth).await? {
        KeyboardOutcome::Authenticated => Ok(ConnectOutcome::Ready(connection)),
        KeyboardOutcome::NeedsPrompt(prompt) => Ok(ConnectOutcome::NeedsSecret { connection, prompt }),
        KeyboardOutcome::Rejected => Err(SshError::AuthRejected),
    }
}

/// Выполняет один шаг авторизации по плану.
async fn authenticate(
    connection: &Connection,
    config: &SshConfig,
    session_auth: &SessionAuth,
) -> Result<AuthResult, SshError> {
    let plan = auth::build_auth_plan(config, session_auth)?;

    let mut guard = connection.handle.lock().await;
    match plan {
        AuthPlan::Password(password) => guard
            .authenticate_password(config.user.as_str(), password.unwrap_or_default())
            .await
            .map_err(SshError::Rus),
        AuthPlan::Key { key, .. } => {
            let hash_alg = guard.best_supported_rsa_hash().await.ok().flatten();
            guard
                .authenticate_publickey(
                    config.user.as_str(),
                    PrivateKeyWithHashAlg::new(key, hash_alg.flatten()),
                )
                .await
                .map_err(SshError::Rus)
        }
    }
}

/// Итог попытки начать диалог keyboard-interactive.
enum KeyboardOutcome {
    /// Диалог не потребовался: авторизация уже завершена.
    Authenticated,
    /// Сервер ждёт данные пользователя.
    NeedsPrompt(SecretPrompt),
    /// Сервер отказал.
    Rejected,
}

/// Начинает диалог keyboard-interactive, если сервер его поддерживает.
///
/// Известный пароль отправляется сразу, не показывая форму ввода. При
/// ключевом методе авторизации пароль не отправляется: пользователь выбрал
/// ключ (порядок как в `openSshSession` из `ipc-handlers.ts`).
async fn start_keyboard_interactive(
    connection: &Connection,
    config: &SshConfig,
    session_auth: &SessionAuth,
) -> Result<KeyboardOutcome, SshError> {
    let first = {
        let mut guard = connection.handle.lock().await;
        guard
            .authenticate_keyboard_interactive_start(config.user.as_str(), None::<String>)
            .await
            .map_err(SshError::Rus)?
    };

    let (name, instructions, prompts) = match first {
        KeyboardInteractiveAuthResponse::Success => return Ok(KeyboardOutcome::Authenticated),
        KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(KeyboardOutcome::Rejected),
        KeyboardInteractiveAuthResponse::InfoRequest { name, instructions, prompts } => (name, instructions, prompts),
    };

    let known_password = if config.auth_type_is_key() {
        None
    } else {
        auth::known_password(config, session_auth)
    };

    if let Some(password) = known_password {
        let response = {
            let mut guard = connection.handle.lock().await;
            guard
                .authenticate_keyboard_interactive_respond(build_keyboard_responses(&password, prompts.len()))
                .await
                .map_err(SshError::Rus)?
        };
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(KeyboardOutcome::Authenticated),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(KeyboardOutcome::Rejected),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts: next, .. } => {
                return Ok(KeyboardOutcome::NeedsPrompt(SecretPrompt::Password {
                    name,
                    instructions,
                    prompts: next.into_iter().map(|item| item.prompt).collect(),
                }));
            }
        }
    }

    Ok(KeyboardOutcome::NeedsPrompt(SecretPrompt::Password {
        name,
        instructions,
        prompts: prompts.into_iter().map(|item| item.prompt).collect(),
    }))
}

/// Продолжает авторизацию ответом пользователя.
///
/// Для `Passphrase` план авторизации пересобирается с парольной фразой; для
/// `Password` продолжается диалог keyboard-interactive. `Ok(true)` означает
/// «соединение авторизовано».
pub async fn resume_with_secret(
    connection: &Connection,
    config: &SshConfig,
    session_auth: &SessionAuth,
    prompt: &SecretPrompt,
    secret: &str,
) -> Result<bool, SshError> {
    match prompt {
        SecretPrompt::Passphrase => {
            let mut with_passphrase = session_auth.clone();
            with_passphrase.key_passphrase = Some(secret.to_owned());
            Ok(authenticate(connection, config, &with_passphrase).await?.success())
        }
        SecretPrompt::Password { prompts, .. } => {
            let mut current = {
                let mut guard = connection.handle.lock().await;
                guard
                    .authenticate_keyboard_interactive_respond(build_keyboard_responses(secret, prompts.len()))
                    .await
                    .map_err(SshError::Rus)?
            };

            // Сервер вправе прислать несколько InfoRequest подряд.
            for _ in 0..4 {
                match current {
                    KeyboardInteractiveAuthResponse::Success => return Ok(true),
                    KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
                    KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                        let count = prompts.len().max(1);
                        let mut guard = connection.handle.lock().await;
                        current = guard
                            .authenticate_keyboard_interactive_respond(build_keyboard_responses(secret, count))
                            .await
                            .map_err(SshError::Rus)?;
                    }
                }
            }
            Err(SshError::Localized("Слишком много раундов авторизации".to_owned()))
        }
    }
}

/// Открывает канал сессии (основа для shell/exec/sftp).
pub async fn open_session_channel(connection: &Connection) -> Result<russh::Channel<russh::client::Msg>, SshError> {
    let channel = {
        let guard = connection.handle.lock().await;
        guard.channel_open_session().await.map_err(SshError::Rus)
    }?;
    Ok(channel)
}

/// Выполняет команду на сервере отдельным каналом.
///
/// stdout и stderr разбираются раздельно (как в Electron-версии с отдельным
/// `channel.stderr`), код возврата берётся из обработчика сессии.
pub async fn exec(connection: &Connection, command: &str) -> Result<ExecOutcome, SshError> {
    match tokio::time::timeout(EXEC_TIMEOUT, exec_inner(connection, command)).await {
        Ok(result) => result,
        Err(_) => Err(SshError::Localized(format!(
            "Выполнение команды не завершилось за {} секунд",
            EXEC_TIMEOUT.as_secs()
        ))),
    }
}

async fn exec_inner(connection: &Connection, command: &str) -> Result<ExecOutcome, SshError> {
    let channel = open_session_channel(connection).await?;
    let channel_id = channel.id().number();
    channel.exec(true, command.to_owned()).await.map_err(SshError::Rus)?;

    let (mut read_half, _write_half) = channel.split();
    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();

    while let Some(msg) = read_half.wait().await {
        match msg {
            ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, ext } if ext == 1 => stderr.extend_from_slice(&data),
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }

    let code = connection.exit_status(channel_id).await;
    Ok(ExecOutcome {
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        code: Some(i64::from(code)),
    })
}

impl Connection {
    /// Код возврата канала: сервер присылает его отдельным сообщением уже
    /// после закрытия потока, поэтому он хранится обработчиком сессии.
    async fn exit_status(&self, channel_id: u32) -> u32 {
        for _ in 0..50 {
            if let Ok(guard) = self.exit_status.try_lock() {
                if let Some(status) = guard.get(&channel_id) {
                    return *status;
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        0
    }

    pub fn is_closed(&self) -> bool {
        self.handle.try_lock().map(|guard| guard.is_closed()).unwrap_or(true)
    }

    /// Закрывает соединение явно (аналог `stream.close()` в Electron-версии).
    pub async fn disconnect(&self, reason: &str) {
        if let Ok(guard) = self.handle.try_lock() {
            let _ = guard.disconnect(russh::Disconnect::ByApplication, reason, "ru").await;
        }
    }
}

/// Пустая таблица кодов возврата (для тестов и утилит).
pub fn empty_exit_status() -> HashMap<u32, u32> {
    HashMap::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ответы_keyboard_interactive() {
        assert_eq!(build_keyboard_responses("s", 1), vec!["s".to_owned()]);
        assert!(build_keyboard_responses("s", 0).is_empty());
        assert_eq!(
            build_keyboard_responses("s", 3),
            vec!["s".to_owned(), String::new(), String::new()]
        );
    }
}
