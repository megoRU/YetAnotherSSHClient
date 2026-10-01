use super::*;
use crate::tests::ssh_server::{ServerOptions, TestServer};
use tokio::io::AsyncReadExt as _;

/// Реестр с готовой сессией оболочки на тестовом сервере.
///
/// `AppHandle` в тестах недоступен, поэтому сессия собирается вручную: тот
/// же путь, что и в [`SessionRegistry::on_authenticated`] — соединение,
/// канал, PTY, shell и разделение канала на половины.
async fn registry_with_shell() -> (SessionRegistry, TestServer) {
    let server = TestServer::start(ServerOptions::default()).await;
    let config = server.config();
    let (events, _receiver) = tokio::sync::mpsc::unbounded_channel();
    let connection = match session::connect(&config, &SessionAuth::default(), "test", events).await {
        Ok(ConnectOutcome::Ready(connection)) => connection,
        _ => panic!("подключение к тестовому серверу не удалось"),
    };

    let channel = session::open_session_channel(&connection).await.expect("канал");
    channel
        .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .expect("pty");
    channel.request_shell(true).await.expect("shell");
    let (_read_half, write_half) = channel.split();

    let mut terminals = HashMap::new();
    terminals.insert(
        "tab-1".to_owned(),
        TerminalSession {
            config,
            connection,
            write_half: Some(write_half),
            forwards: HashMap::new(),
        },
    );

    let registry = SessionRegistry {
        terminals: Mutex::new(terminals),
        ..SessionRegistry::default()
    };
    (registry, server)
}

#[tokio::test]
async fn ввод_пользователя_доходит_до_сервера() {
    let (registry, server) = registry_with_shell().await;

    registry.input("tab-1", "uname -a\n").await;

    assert!(
        server
            .probe
            .wait_for_shell_input("uname -a\n", Duration::from_secs(5))
            .await,
        "сервер не получил введённую команду"
    );
}

/// Регрессия: команды при подключении печатались в терминал, но на сервер
/// не уходили, поэтому скрипт не выполнялся.
#[tokio::test]
async fn команды_при_подключении_уходят_на_server() {
    let (registry, server) = registry_with_shell().await;

    registry.send_initial_commands("tab-1", Some("cd /tmp\nls -la\n")).await;

    assert!(
        server
            .probe
            .wait_for_shell_input_all(&["cd /tmp\n", "ls -la\n"], Duration::from_secs(5))
            .await,
        "сервер не получил команды при подключении, ввод: {:?}",
        String::from_utf8_lossy(&server.probe.shell_input())
    );
}

#[tokio::test]
async fn пустые_команды_при_подключении_не_отправляются() {
    let (registry, server) = registry_with_shell().await;

    registry.send_initial_commands("tab-1", Some("\n  \n")).await;
    registry.send_initial_commands("tab-1", None).await;

    assert!(server.probe.shell_input().is_empty(), "в пустой список команд писать нечего");
}

/// Право на повторный запрос пароля проверяется по `auth_states`, поэтому
/// состояние обязано существовать на момент проверки.
///
/// Регрессия: в ветке отказа авторизации состояние удалялось **до** вызова
/// `can_request_auth`, который читает ту же карту. Проверка всегда давала
/// `false`, и первый же отказ завершался сообщением «неверный логин или
/// пароль» — форма ввода пароля не появлялась никогда, сервер так и не
/// спросил пароль.
#[tokio::test]
async fn отказ_авторизации_оставляет_право_запросить_пароль() {
    let registry = SessionRegistry::new();
    let config = SshConfig {
        host: "127.0.0.1".to_owned(),
        user: "root".to_owned(),
        ..SshConfig::default()
    };

    // Первая попытка: состояние заведено, попытки ещё есть.
    registry.begin_attempt("tab-1", &config, 80, 24, 0).await;
    assert!(
        registry.can_request_auth("tab-1").await,
        "на первой попытке пароль спросить обязаны"
    );

    // Порядок как в `connect`: сначала проверка права, потом удаление.
    let may_retry = registry.can_request_auth("tab-1").await;
    registry.auth_states.lock().await.remove("tab-1");

    assert!(may_retry, "право запросить пароль потеряно до проверки");
    assert!(
        !registry.can_request_auth("tab-1").await,
        "состояние без записи прав не должно давать разрешение"
    );
}

/// Попытки ограничены, иначе сервер, отклоняющий пароль, заставил бы
/// приложение спрашивать его бесконечно.
#[tokio::test]
async fn число_попыток_авторизации_ограничено() {
    let registry = SessionRegistry::new();
    let config = SshConfig { host: "127.0.0.1".to_owned(), ..SshConfig::default() };

    let state_with_attempt = |attempt: u16| AuthState {
        config: config.clone(),
        cols: 80,
        rows: 24,
        attempt,
        session: SessionAuth::default(),
        connection: None,
        prompt: None,
    };

    // Пока лимит не выбран, пароль спросить можно: попыток 0..MAX-1.
    for attempt in 0..MAX_AUTH_ATTEMPTS {
        registry.auth_states.lock().await.insert("tab-1".to_owned(), state_with_attempt(attempt));
        assert!(
            registry.can_request_auth("tab-1").await,
            "попытка {attempt} из {MAX_AUTH_ATTEMPTS} отклонена, хотя лимит не выбран"
        );
    }

    // Дальше лимит исчерпан: ещё раз спрашивать пароль нельзя, иначе сервер,
    // отвергающий любой ввод, заставил бы приложение повторять бесконечно.
    registry.auth_states.lock().await.insert("tab-1".to_owned(), state_with_attempt(MAX_AUTH_ATTEMPTS));
    assert!(
        !registry.can_request_auth("tab-1").await,
        "после {MAX_AUTH_ATTEMPTS} попыток пароль спрашивается снова"
    );
}

#[tokio::test]
async fn ввод_в_неизвестную_сессию_не_паникует() {
    let (registry, _server) = registry_with_shell().await;

    registry.input("нет-такой-вкладки", "ls\n").await;
}

#[tokio::test]
async fn закрытие_вкладки_снимает_сессию() {
    let (registry, server) = registry_with_shell().await;

    registry.teardown("tab-1").await;

    assert!(registry.terminals.lock().await.is_empty());
    // После закрытия ввод не должен падать и не должен уходить на сервер.
    registry.input("tab-1", "ls\n").await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(server.probe.shell_input().is_empty());
}

/// Перенаправление портов поднимает локальный слушатель и пробрасывает
/// соединения на удалённый адрес: клиент обязан получить данные от «сервера».
#[tokio::test]
async fn перенаправление_портов_пробрасывает_данные() {
    let server = TestServer::start(ServerOptions::default()).await;
    let registry = SessionRegistry::new();

    // Свободный порт подбираем заранее: `forward_start` работает с явным
    // портом, а `0` в ключе перенаправления остался бы «0».
    let probe = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("свободный порт");
    let local_port = probe.local_addr().expect("адрес").port();
    drop(probe);

    let started = registry
        .forward_start("tab-1", server.config(), "127.0.0.1", local_port, "example.com", 8080)
        .await;
    assert!(started.expect("перенаправление запустилось"), "сервер не принял запрос");

    // Пишем в локальный порт и читаем эхо обратно: так проверяется и открытие
    // канала перенаправления, и передача данных в обе стороны.
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", local_port)).await.expect("подключение");
    stream.write_all(b"ping").await.expect("запись в локальный порт");
    stream.flush().await.expect("сброс");

    let mut echoed = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while echoed.len() < 4 {
        let mut buffer = [0u8; 64];
        let read = tokio::time::timeout_at(deadline, stream.read(&mut buffer))
            .await
            .expect("эхо так и не пришло")
            .expect("чтение");
        if read == 0 {
            break;
        }
        echoed.extend_from_slice(&buffer[..read]);
    }

    assert_eq!(String::from_utf8_lossy(&echoed), "ping", "данные не прошли через перенаправление");
    assert_eq!(
        server.probe.forwarded_channels(),
        vec!["example.com:8080".to_owned()],
        "сервер получил запрос на неверный адрес"
    );
    assert_eq!(server.probe.forwarded_data(), b"ping", "сервер не получил данные клиента");

    // После остановки порт закрывается: следующее подключение не проходит.
    assert!(registry.forward_stop("tab-1").await, "остановка не сработала");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", local_port)).await.is_err(),
        "порт остался открытым"
    );
}
