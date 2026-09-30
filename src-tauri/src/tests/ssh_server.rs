//! Тестовый SSH-сервер на базе `russh`.
//!
//! Нужен, чтобы проверять клиентский код приложения (авторизация, канал
//! оболочки, ввод, exec, перенаправление портов) без внешнего `sshd`: сервер
//! поднимается на `127.0.0.1:0` в рамках теста и ведёт себя как эхо-оболочка.
//!
//! Сервер намеренно простой: пароль принимается всегда (если не задан
//! [`ServerOptions::reject_password`]), оболочка отражает введённые данные,
//! `exec` возвращает заранее заданный вывод, каналы перенаправления портов
//! принимаются и сразу закрываются.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::PrivateKey;
use russh::server::{Auth, ChannelOpenHandle, Config, Handler, Msg, Server, Session};
use russh::{Channel, ChannelId, Error as RusshError};
use tokio::net::TcpListener;

use crate::config::SshConfig;

/// Приветствие оболочки: отправляется сразу после `shell_request`.
pub const SHELL_BANNER: &str = "welcome-to-test-shell\r\n";

/// Создаёт ключ хоста для тестового сервера.
///
/// Ключ генерируется при каждом запуске теста: в исходниках не хранится ни
/// одного приватного ключа — даже тестового (поиск по репозиторию и сканеры
/// секретов не должны находить «ключи» в коде).
pub fn host_key() -> PrivateKey {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("системная энтропия");
    PrivateKey::from(Ed25519Keypair::from_seed(&seed))
}

/// Создаёт клиентский ключ (тот же формат, что принимает сервер).
pub fn client_key() -> PrivateKey {
    host_key()
}

/// Вывод `exec`: команда, stdout, stderr и код возврата.
#[derive(Clone, Debug)]
pub struct ExecReply {
    pub stdout: String,
    pub stderr: String,
    pub code: u32,
}

impl Default for ExecReply {
    fn default() -> Self {
        ExecReply {
            stdout: String::new(),
            stderr: String::new(),
            code: 0,
        }
    }
}

/// Настройки тестового сервера.
#[derive(Clone, Debug, Default)]
pub struct ServerOptions {
    /// Отклонять любой пароль (для проверки неуспешной авторизации).
    pub reject_password: bool,
    /// Отклонять keyboard-interactive (иначе клиент продолжит диалог после
    /// неверного пароля и авторизуется).
    pub reject_keyboard_interactive: bool,
    /// Принимать авторизацию по публичному ключу.
    pub accept_publickey: bool,
    /// Ответ на `exec`.
    pub exec_reply: ExecReply,
    /// Не подтверждать запрос PTY (`request_pty` завершится ошибкой).
    pub reject_pty: bool,
}

/// Что сервер наблюдает во время теста.
#[derive(Default)]
pub struct ServerState {
    /// Пароли, предъявленные серверу (в порядке поступления).
    pub passwords: Vec<String>,
    /// Логины, для которых была попытка авторизации.
    pub users: Vec<String>,
    /// Публичные ключи, предъявленные серверу (отпечатки в hex).
    pub public_keys: Vec<String>,
    /// Тип терминала и размеры каждого запроса PTY.
    pub pty_requests: Vec<(String, u32, u32)>,
    /// Команды, выполненные через `exec`.
    pub exec_commands: Vec<String>,
    /// Всё, что пришло в каналы оболочки, в порядке поступления.
    pub shell_input: Vec<u8>,
    /// Каналы перенаправления портов: `host:port` на каждое подключение.
    pub forwarded_channels: Vec<String>,
    /// Данные, пришедшие в каналы перенаправления (эхо-проверка).
    pub forwarded_data: Vec<u8>,
    /// Размеры окна, о которых сообщал клиент (`window-change`).
    pub window_changes: Vec<(u32, u32)>,
    /// Ответы клиента на keyboard-interactive.
    pub keyboard_responses: Vec<String>,
}

/// Обёртка над [`ServerState`]: тесты читают состояние из нескольких задач.
#[derive(Clone, Default)]
pub struct ServerProbe {
    inner: Arc<Mutex<ServerState>>,
}

impl ServerProbe {
    fn lock(&self) -> std::sync::MutexGuard<'_, ServerState> {
        // Отравление Mutex в тестах не восстанавливаем: падение должно быть
        // видно сразу, а не через последующие пустые состояния.
        self.inner.lock().expect("server state")
    }

    /// Всё, что сервер получил в канале оболочки.
    pub fn shell_input(&self) -> Vec<u8> {
        self.lock().shell_input.clone()
    }

    /// Ждёт, пока ввод оболочки будет содержать подстроку.
    pub async fn wait_for_shell_input(&self, needle: &str, timeout: Duration) -> bool {
        self.wait_until(timeout, || self.lock().shell_input.windows(needle.len()).any(|w| w == needle.as_bytes()))
            .await
    }

    /// Ждёт, пока ввод оболочки будет содержать все подстроки.
    pub async fn wait_for_shell_input_all(&self, needles: &[&str], timeout: Duration) -> bool {
        self.wait_until(timeout, || {
            let state = self.lock();
            needles
                .iter()
                .all(|needle| state.shell_input.windows(needle.len()).any(|w| w == needle.as_bytes()))
        })
        .await
    }

    /// Ждёт выполнения условия над состоянием сервера.
    pub async fn wait_until(&self, timeout: Duration, condition: impl Fn() -> bool) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if condition() {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// Список команд `exec`.
    pub fn exec_commands(&self) -> Vec<String> {
        self.lock().exec_commands.clone()
    }

    /// Список запросов PTY.
    pub fn pty_requests(&self) -> Vec<(String, u32, u32)> {
        self.lock().pty_requests.clone()
    }

    /// Каналы перенаправления портов.
    pub fn forwarded_channels(&self) -> Vec<String> {
        self.lock().forwarded_channels.clone()
    }

    /// Данные, дошедшие до сервера через перенаправление портов.
    pub fn forwarded_data(&self) -> Vec<u8> {
        self.lock().forwarded_data.clone()
    }

    /// Размеры окна, о которых сообщал клиент.
    pub fn window_changes_snapshot(&self) -> Vec<(u32, u32)> {
        self.lock().window_changes.clone()
    }

    /// Предъявленные пароли.
    pub fn passwords(&self) -> Vec<String> {
        self.lock().passwords.clone()
    }

    /// Логины, для которых была попытка авторизации.
    pub fn users(&self) -> Vec<String> {
        self.lock().users.clone()
    }

    /// Предъявленные публичные ключи (hex-отпечатки).
    pub fn public_keys(&self) -> Vec<String> {
        self.lock().public_keys.clone()
    }
}

/// Запущенный тестовый сервер.
pub struct TestServer {
    /// Порт, на котором сервер слушает.
    pub port: u16,
    /// Наблюдаемое состояние.
    pub probe: ServerProbe,
}

impl TestServer {
    /// Поднимает сервер на свободном порту `127.0.0.1`.
    pub async fn start(options: ServerOptions) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind test server");
        let port = listener.local_addr().expect("addr").port();

        let mut config = Config::default();
        config.keys.push(host_key());
        config.inactivity_timeout = None;
        config.auth_rejection_time = Duration::from_millis(50);
        let config = Arc::new(config);

        let probe = ServerProbe::default();
        let accept_probe = probe.clone();
        tokio::spawn(async move {
            while let Ok((stream, _peer)) = listener.accept().await {
                let config = config.clone();
                let options = options.clone();
                let probe = accept_probe.clone();
                tokio::spawn(async move {
                    let handler = TestHandler {
                        options,
                        probe,
                        exec_channels: HashMap::new(),
                        echo_channels: Vec::new(),
                    };
                    // Ошибки соединения (клиент закрыл раньше времени) для теста
                    // не значимы — интересует только то, что сервер принял.
                    let _ = russh::server::run_stream(config, stream, handler).await;
                });
            }
        });

        TestServer { port, probe }
    }

    /// Конфигурация подключения к серверу.
    pub fn config(&self) -> SshConfig {
        SshConfig {
            name: "test-server".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: self.port,
            user: "tester".to_owned(),
            password: Some("secret".to_owned()),
            ..SshConfig::default()
        }
    }

    /// Конфигурация авторизации по ключу: ключ в открытом виде (как его вводит
    /// пользователь в текущей сессии), сервер принимает любой.
    pub fn config_with_key(&self, key: &PrivateKey) -> SshConfig {
        // `to_openssh` возвращает `Zeroizing<String>`, поэтому в JSON кладём
        // копию: формат ключа в конфиге — такой же, как его вводит пользователь.
        let text = key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .expect("ключ в формате OpenSSH")
            .to_string();
        SshConfig {
            name: "test-server".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: self.port,
            user: "tester".to_owned(),
            auth_type: Some("key".to_owned()),
            private_key: Some(serde_json::json!(text)),
            ..SshConfig::default()
        }
    }
}

/// Обработчик соединения тестового сервера.
struct TestHandler {
    options: ServerOptions,
    probe: ServerProbe,
    /// Каналы, открытые под `exec`: ввод туда не отражается.
    exec_channels: HashMap<u32, ()>,
    /// Каналы перенаправления портов: работают как эхо.
    echo_channels: Vec<u32>,
}

impl TestHandler {
    fn record(&self, apply: impl FnOnce(&mut ServerState)) {
        apply(&mut self.probe.lock());
    }
}

impl Server for TestHandler {
    type Handler = Self;

    fn new_client(&mut self, _peer: Option<std::net::SocketAddr>) -> Self {
        Self {
            options: self.options.clone(),
            probe: self.probe.clone(),
            exec_channels: HashMap::new(),
            echo_channels: Vec::new(),
        }
    }
}

impl Handler for TestHandler {
    type Error = RusshError;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        self.record(|state| {
            state.users.push(user.to_owned());
            state.passwords.push(password.to_owned());
        });
        if self.options.reject_password {
            Ok(Auth::Reject {
                proceed_with_methods: None,
                partial_success: false,
            })
        } else {
            Ok(Auth::Accept)
        }
    }

    async fn auth_publickey(&mut self, user: &str, key: &russh::keys::ssh_key::PublicKey) -> Result<Auth, Self::Error> {
        self.record(|state| {
            state.users.push(user.to_owned());
            state
                .public_keys
                .push(key.fingerprint(russh::keys::ssh_key::HashAlg::Sha256).to_string());
        });
        if self.options.accept_publickey {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    /// Первый вызов без ответа возвращает приглашение, второй (с ответом) —
    /// успех. Так проверяется работа приложения с keyboard-interactive.
    async fn auth_keyboard_interactive<'a>(
        &mut self,
        _user: &str,
        _submethods: &str,
        response: Option<russh::server::Response<'a>>,
    ) -> Result<Auth, Self::Error> {
        if self.options.reject_keyboard_interactive {
            return Ok(Auth::reject());
        }
        match response {
            None => Ok(Auth::Partial {
                name: "verification".into(),
                instructions: "enter code".into(),
                prompts: vec![("Code: ".into(), false)].into(),
            }),
            Some(response) => {
                let answers: Vec<String> = response
                    .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
                    .collect();
                self.record(|state| state.keyboard_responses.extend(answers));
                Ok(Auth::Accept)
            }
        }
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.exec_channels.contains_key(&channel.number()) {
            return Ok(());
        }
        // Каналы перенаправления портов работают как эхо: клиент пишет в
        // локальный порт, сервер возвращает данные обратно.
        if self.echo_channels.contains(&channel.number()) {
            self.record(|state| state.forwarded_data.extend_from_slice(data));
            session.data(channel, data.to_vec())?;
            return Ok(());
        }
        self.record(|state| state.shell_input.extend_from_slice(data));
        // Эхо, как у настоящего терминала: клиент сразу видит введённое.
        session.data(channel, data.to_vec())?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        _channel: ChannelId,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(|state| state.window_changes.push((col_width, row_height)));
        session.channel_success(_channel)?;
        Ok(())
    }

    async fn pty_request(
        &mut self,
        channel: ChannelId,
        term: &str,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(|state| state.pty_requests.push((term.to_owned(), col_width, row_height)));
        if self.options.reject_pty {
            session.channel_failure(channel)?;
        } else {
            session.channel_success(channel)?;
        }
        Ok(())
    }

    async fn shell_request(&mut self, channel: ChannelId, session: &mut Session) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, SHELL_BANNER.as_bytes().to_vec())?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.exec_channels.insert(channel.number(), ());
        self.record(|state| {
            state
                .exec_commands
                .push(String::from_utf8_lossy(data).trim_end().to_string())
        });
        session.channel_success(channel)?;
        let reply = &self.options.exec_reply;
        if !reply.stdout.is_empty() {
            session.data(channel, reply.stdout.as_bytes().to_vec())?;
        }
        if !reply.stderr.is_empty() {
            session.extended_data(channel, 1, reply.stderr.as_bytes().to_vec())?;
        }
        session.exit_status_request(channel, reply.code)?;
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    /// Канал `direct-tcpip` — это и есть перенаправление портов: клиент просит
    /// сервер соединиться с удалённым адресом от его имени.
    ///
    /// Канал работает как эхо: данные, пришедшие от клиента, возвращаются
    /// обратно. Так проверяется и открытие канала, и передача в обе стороны.
    #[allow(clippy::too_many_arguments)]
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(|state| state.forwarded_channels.push(format!("{host_to_connect}:{port_to_connect}")));
        self.echo_channels.push(channel.id().number());
        reply.accept().await;
        Ok(())
    }
}