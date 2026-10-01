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