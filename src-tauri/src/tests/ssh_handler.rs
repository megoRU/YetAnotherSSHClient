use super::*;

/// Ошибка хранилища секретов показывается пользователю переводом из словаря
/// бэкенда, а не техническим текстом: по нему UI зовёт открыть хранилище.
#[test]
fn закрытое_хранилище_даёт_локализованный_текст() {
    let error = SshError::VaultLocked;
    assert_eq!(error.localized(), crate::i18n::t("errors.vaultLocked", &[]));
    // Технический вариант остаётся для журнала.
    assert_eq!(error.to_string(), "Хранилище заблокировано");
}

/// Ошибка приватного ключа показывается переводом той же причины, что и при
/// импорте ключа в настройках: пользователь видит одинаковый текст.
#[test]
fn ошибка_ключа_даёт_локализованный_текст() {
    let key_error = crate::keys::PrivateKeyError {
        failure: crate::keys::PrivateKeyFailure::Passphrase,
        message: "passphrase required".to_owned(),
    };
    let error = SshError::PrivateKey(key_error);
    // UI получает перевод причины без технического сообщения.
    assert_eq!(error.localized(), crate::i18n::t("errors.keyPassphraseRequired", &[]));
    // В журнал уходит вариант с указанием источника — так ошибка читается в
    // баг-репорте («Приватный ключ: …»), а не просто «Ключ зашифрован…».
    assert!(error.to_string().starts_with("Приватный ключ:"), "технический текст потерял источник: {error}");
    assert!(!error.to_string().contains("passphrase"), "во внешнюю строку попал внутренний код");
}

/// Отказ авторизации и отмена — готовые тексты: пользователь различает их по
/// смыслу («неверный пароль» против «закрыл окно»).
#[test]
fn отказ_и_отмена_различаются() {
    assert_eq!(SshError::AuthRejected.to_string(), "Авторизация отклонена сервером");
    assert_eq!(SshError::Cancelled.to_string(), "Отменено пользователем");
    assert_ne!(SshError::AuthRejected.localized(), SshError::Cancelled.localized());
}

/// Собственный текст ошибки (таймаут, локализованное сообщение) проходит
/// через UI без изменений — так бэкенд управляет формулировками.
#[test]
fn собственный_текст_не_переводится_повторно() {
    let error = SshError::Localized("Не удалось подключиться к example.com".to_owned());
    assert_eq!(error.localized(), "Не удалось подключиться к example.com");
    assert_eq!(error.to_string(), error.localized());
}

/// Ошибки `russh` и `io` показываются как есть: они уже содержат понятный
/// пользователю текст, а перевод для них не заведён.
#[test]
fn системные_ошибки_показываются_как_есть() {
    let io = SshError::Io(std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "connection refused"));
    assert!(io.localized().contains("connection refused"));
    assert!(!io.localized().is_empty());
}

/// Ошибки разбираются из стандартных типов автоматически: `?` в коде команды
/// не должен требовать ручного перечисления вариантов.
#[test]
fn ошибки_создаются_из_стандартных_типов() {
    let from_io: SshError = std::io::Error::other("диск недоступен").into();
    assert!(matches!(from_io, SshError::Io(_)));
    assert!(from_io.localized().contains("диск недоступен"));

    let key_error = crate::keys::PrivateKeyError {
        failure: crate::keys::PrivateKeyFailure::Missing,
        message: "PRIVATE_KEY_NOT_FOUND".to_owned(),
    };
    let from_key: SshError = key_error.into();
    assert!(matches!(from_key, SshError::PrivateKey(_)));
    assert_eq!(from_key.localized(), crate::i18n::t("errors.privateKeyNotSet", &[]));
}

/// Обёртка для обмена ошибками между задачами существует ради удобства и не
/// должна ломать вывод: ошибка остаётся читаемой после Arc-оборачивания.
#[test]
fn обёртка_ошибки_читаема() {
    let shared: SharedSshError = Arc::new(SshError::VaultLocked);
    assert_eq!(shared.localized(), crate::i18n::t("errors.vaultLocked", &[]));
}

// ── Проверка ключа хоста ─────────────────────────────────────────────────────

/// Отпечаток вычисляется в формате OpenSSH: пользователь сверяет его с выводом
/// `ssh-keygen -lf` на сервере, поэтому формат должен совпадать посимвольно.
#[test]
fn отпечаток_в_формате_openssh() {
    let key = crate::tests::ssh_server::host_key();
    let fingerprint = host_key_fingerprint(&key.public_key().clone().into()).expect("отпечаток");

    assert!(fingerprint.starts_with("SHA256:"), "неожиданный формат: {fingerprint}");
    // base64 без переводов строк и отступов: значение показывается в одном блоке.
    let digest = fingerprint.trim_start_matches("SHA256:");
    assert!(!digest.is_empty(), "пустой отпечаток");
    assert!(
        digest.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '='),
        "в отпечатке есть посторонние символы: {fingerprint}"
    );
}

/// Один и тот же ключ всегда даёт один и тот же отпечаток: иначе подтверждение
/// невозможно — при следующем подключении ключ выглядел бы «изменившимся».
#[test]
fn отпечаток_стабилен_для_одного_ключа() {
    let key = crate::tests::ssh_server::host_key();
    let public = key.public_key().clone();
    let first = host_key_fingerprint(&public.clone().into()).expect("первый");
    let second = host_key_fingerprint(&public.into()).expect("второй");
    assert_eq!(first, second);
}

/// Разные ключи дают разные отпечатки — иначе подтверждение ничего не значило бы.
#[test]
fn разные_ключи_дают_разные_отпечатки() {
    let first = crate::tests::ssh_server::host_key();
    let second = crate::tests::ssh_server::host_key();

    let a = host_key_fingerprint(&first.public_key().clone().into()).expect("первый");
    let b = host_key_fingerprint(&second.public_key().clone().into()).expect("второй");
    assert_ne!(a, b, "разные ключи получили одинаковый отпечаток");
}

/// Ключ принимается молча только при совпадении с сохранённым отпечатком.
///
/// Проверяется ровно то решение, из-за которого защита работает: расхождение
/// обязано приводить к `false` и попадать в слот для UI, иначе пользователя
/// никто не спросит, а ключ подменится молча.
#[tokio::test]
async fn ключ_принимается_только_при_совпадении_отпечатка() {
    use russh::client::Handler as _;

    let key = crate::tests::ssh_server::host_key();
    let public = key.public_key().clone();
    let fingerprint = host_key_fingerprint(&public.clone().into()).expect("отпечаток");
    let (events, _receiver) = mpsc::unbounded_channel();

    // Совпадение: подтверждение не требуется, слот остаётся пустым.
    let (mut handler, _status, offered) =
        ClientHandler::new("tab".to_owned(), events, Some(fingerprint.clone()));
    assert!(handler.check_server_key(&public.clone().into()).await.expect("проверка"));
    assert!(take_offered_key(&offered).is_none(), "при совпадении ключ не должен попадать в слот");

    // Расхождение: ключ отклоняется, отпечаток уходит в UI.
    let (events, _receiver) = mpsc::unbounded_channel();
    let (mut handler, _status, offered) =
        ClientHandler::new("tab".to_owned(), events, Some("SHA256:чужой".to_owned()));
    assert!(!handler.check_server_key(&public.clone().into()).await.expect("проверка"));
    assert_eq!(
        take_offered_key(&offered).as_deref(),
        Some(fingerprint.as_str()),
        "отпечаток не дошёл до UI, пользователя не спросят"
    );

    // Первое подключение: сохранённого отпечатка нет, спрашиваем.
    let (events, _receiver) = mpsc::unbounded_channel();
    let (mut handler, _status, offered) = ClientHandler::new("tab".to_owned(), events, None);
    assert!(!handler.check_server_key(&public.into()).await.expect("проверка"));
    assert_eq!(take_offered_key(&offered).as_deref(), Some(fingerprint.as_str()));
}

/// Отпечаток забирается из слота только один раз: повторный `take` вернул бы
/// `None`, и второе подключение осталось бы без запроса подтверждения.
#[tokio::test]
async fn отпечаток_забирается_из_слота_один_раз() {
    use russh::client::Handler as _;

    let key = crate::tests::ssh_server::host_key();
    let public = key.public_key().clone();
    let fingerprint = host_key_fingerprint(&public.clone().into()).expect("отпечаток");
    let (events, _receiver) = mpsc::unbounded_channel();

    let (mut handler, _status, offered) = ClientHandler::new("tab".to_owned(), events, None);
    assert!(!handler.check_server_key(&public.into()).await.expect("проверка"));

    assert_eq!(take_offered_key(&offered).as_deref(), Some(fingerprint.as_str()));
    assert!(take_offered_key(&offered).is_none(), "слот отдаёт отпечаток повторно");
}