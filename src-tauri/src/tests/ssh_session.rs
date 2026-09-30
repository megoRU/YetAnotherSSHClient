use super::*;
use crate::tests::ssh_server::{client_key, ExecReply, ServerOptions, TestServer, SHELL_BANNER};

/// Тестовый ключ, зашифрованный в хранилище секретов.
///
/// Ключ приходит в конфиге зашифрованным, поэтому для тестов авторизации
/// по ключу хранилище надо открыть — так же, как это делает приложение при
/// старте. Сам ключ генерируется на каждый запуск теста.
fn encrypted_test_key() -> crate::config::EncryptedSecret {
    let text = client_key()
        .to_openssh(russh::keys::ssh_key::LineEnding::LF)
        .expect("ключ в формате OpenSSH")
        .to_string();
    let _ = crate::vault::unlock(&crate::paths::random_base64(32), &crate::paths::random_base64(16));
    crate::vault::encrypt(&text).expect("зашифровать тестовый ключ")
}

/// Подключается к тестовому серверу и возвращает соединение.
async fn connect_ok(config: &SshConfig) -> Connection {
    connect_with(config, SessionAuth::default()).await
}

/// Подключается с указанными данными текущей сессии.
async fn connect_with(config: &SshConfig, session: SessionAuth) -> Connection {
    let (events, _receiver) = mpsc::unbounded_channel();
    match connect(config, &session, "test", events).await {
        Ok(ConnectOutcome::Ready(connection)) => connection,
        Ok(ConnectOutcome::NeedsSecret { .. }) => panic!("сервер неожиданно запросил данные пользователя"),
        Err(error) => panic!("подключение не удалось: {error}"),
    }
}

#[tokio::test]
async fn подключается_по_паролю_и_получает_баннер() {
    let server = TestServer::start(ServerOptions::default()).await;
    let connection = connect_ok(&server.config()).await;

    assert_eq!(server.probe.passwords(), vec!["secret".to_owned()]);
    assert_eq!(server.probe.users(), vec!["tester".to_owned()]);
    assert!(!connection.is_closed());
}

/// Ключ из конфига (а не введённый в этой вкладке) тоже должен авторизовать:
/// так сохраняются ключи, добавленные в настройках подключения.
#[tokio::test]
async fn авторизуется_по_ключу_из_конфига() {
    let server = TestServer::start(ServerOptions {
        accept_publickey: true,
        ..ServerOptions::default()
    })
    .await;
    let key = client_key();
    // Ключ в конфиге хранится зашифрованным, поэтому хранилище открываем так же,
    // как это делает приложение при старте.
    let _guard = crate::vault::test_guard();
    let config = server.config_with_key(&key);
    let config = SshConfig {
        private_key: config.private_key.map(|_| {
            let text = key
                .to_openssh(russh::keys::ssh_key::LineEnding::LF)
                .expect("ключ в формате OpenSSH")
                .to_string();
            let _ = crate::vault::unlock(&crate::paths::random_base64(32), &crate::paths::random_base64(16));
            serde_json::to_value(crate::vault::encrypt(&text).expect("зашифровать")).expect("json")
        }),
        ..config
    };

    connect_ok(&config).await;

    assert_eq!(server.probe.public_keys().len(), 1);
    assert!(server.probe.passwords().is_empty(), "при ключе пароль не отправляется");
}

#[tokio::test]
async fn неверный_пароль_даёт_отказ_авторизации() {
    let server = TestServer::start(ServerOptions {
        reject_password: true,
        reject_keyboard_interactive: true,
        ..ServerOptions::default()
    })
    .await;
    let (events, _receiver) = mpsc::unbounded_channel();

    let error = match connect(&server.config(), &SessionAuth::default(), "test", events).await {
        Err(error) => error,
        Ok(_) => panic!("ожидалась ошибка авторизации"),
    };

    assert!(
        matches!(error, SshError::AuthRejected),
        "неожиданная ошибка: {error}"
    );
}

#[tokio::test]
async fn авторизуется_по_приватному_ключу() {
    // Хранилище глобальное: guard держится до конца теста, иначе соседний
    // тест успеет открыть его со своим ключом.
    let _guard = crate::vault::test_guard();
    let server = TestServer::start(ServerOptions {
        accept_publickey: true,
        ..ServerOptions::default()
    })
    .await;
    // Ключ введён в этой вкладке: он важнее ключа и пароля из конфига.
    let session = SessionAuth {
        private_key: Some(encrypted_test_key()),
        ..SessionAuth::default()
    };
    connect_with(&server.config(), session).await;

    assert_eq!(server.probe.public_keys().len(), 1);
    assert!(server.probe.passwords().is_empty());
}

#[tokio::test]
async fn keyboard_interactive_возвращает_запрос_кода() {
    // Ни пароля, ни ключа в конфиге нет, и сервер пароль не принимает —
    // единственный путь остаётся keyboard-interactive с запросом кода.
    let server = TestServer::start(ServerOptions {
        reject_password: true,
        ..ServerOptions::default()
    })
    .await;
    let config = SshConfig {
        password: None,
        ..server.config()
    };
    let (events, _receiver) = mpsc::unbounded_channel();

    match connect(&config, &SessionAuth::default(), "test", events).await {
        Ok(ConnectOutcome::NeedsSecret {
            prompt: SecretPrompt::Password { prompts, .. },
            ..
        }) => assert_eq!(prompts, vec!["Code: ".to_owned()]),
        Ok(_) => panic!("ожидался запрос кода"),
        Err(error) => panic!("ожидался запрос кода, получена ошибка: {error}"),
    }
}

#[tokio::test]
async fn ввод_доходит_до_оболочки() {
    let server = TestServer::start(ServerOptions::default()).await;
    let connection = connect_ok(&server.config()).await;

    let channel = open_session_channel(&connection).await.expect("канал");
    channel
        .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .expect("pty");
    channel.request_shell(true).await.expect("shell");
    let (mut read_half, write_half) = channel.split();

    // Баннер оболочки приходит до ввода: канал читается, а не молчит.
    // Ответы на `request_pty`/`request_shell` приходят первыми, их пропускаем.
    let banner = loop {
        match read_half.wait().await {
            Some(ChannelMsg::Data { data }) => break data,
            Some(ChannelMsg::Eof | ChannelMsg::Close) | None => panic!("оболочка закрылась до приветствия"),
            Some(_) => continue,
        }
    };
    assert_eq!(banner.as_ref(), SHELL_BANNER.as_bytes());

    write_half
        .data_bytes(b"echo ready\n".to_vec())
        .await
        .expect("запись в канал");

    assert!(
        server
            .probe
            .wait_for_shell_input("echo ready\n", Duration::from_secs(5))
            .await,
        "сервер не получил введённую команду"
    );
    assert_eq!(server.probe.pty_requests(), vec![("xterm-256color".to_owned(), 80, 24)]);
}

#[tokio::test]
async fn изменение_размеров_доходит_до_сервера() {
    let server = TestServer::start(ServerOptions::default()).await;
    let connection = connect_ok(&server.config()).await;

    let channel = open_session_channel(&connection).await.expect("канал");
    channel
        .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .expect("pty");
    channel.request_shell(true).await.expect("shell");
    let (_read_half, write_half) = channel.split();

    write_half.window_change(120, 40, 0, 0).await.expect("window change");

    assert!(
        server
            .probe
            .wait_until(Duration::from_secs(5), || {
                server
                    .probe
                    .window_changes_snapshot()
                    .contains(&(120, 40))
            })
            .await,
        "сервер не получил изменение размеров окна"
    );
}

#[tokio::test]
async fn exec_возвращает_потоки_и_код() {
    let server = TestServer::start(ServerOptions {
        exec_reply: ExecReply {
            stdout: "hello\n".to_owned(),
            stderr: "warn\n".to_owned(),
            code: 3,
        },
        ..ServerOptions::default()
    })
    .await;
    let connection = connect_ok(&server.config()).await;

    let outcome = exec(&connection, "cat /etc/os-release").await.expect("exec");

    assert_eq!(outcome.stdout, "hello\n");
    assert_eq!(outcome.stderr, "warn\n");
    assert_eq!(outcome.code, Some(3));
    assert_eq!(server.probe.exec_commands(), vec!["cat /etc/os-release".to_owned()]);
}

#[test]
fn ответы_keyboard_interactive() {
    assert_eq!(build_keyboard_responses("s", 1), vec!["s".to_owned()]);
    assert!(build_keyboard_responses("s", 0).is_empty());
    assert_eq!(
        build_keyboard_responses("s", 3),
        vec!["s".to_owned(), String::new(), String::new()]
    );
}
