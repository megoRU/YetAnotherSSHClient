use super::*;

#[test]
fn классифицирует_ошибку_авторизации() {
    assert_eq!(classify_error("AUTH_FAILURE: неверный пароль"), SftpErrorKind::AuthFailure);
    assert_eq!(classify_error("connection reset"), SftpErrorKind::SshError);
}

#[test]
fn коды_ошибок_совпадают_с_фронтендом() {
    assert_eq!(SftpErrorKind::TcpTimeout.as_str(), "tcp-timeout");
    assert_eq!(SftpErrorKind::ConfigError.as_str(), "config-error");
}

/// Коды ошибок читает фронтенд и показывает по ним текст из i18n: строки
/// должны оставаться в kebab-case и быть уникальными, иначе появится
/// необработанный код и пользователь увидит сырое значение.
#[test]
fn все_коды_ошибок_уникальны_и_в_kebab_case() {
    let kinds = [
        SftpErrorKind::AuthFailure,
        SftpErrorKind::TcpTimeout,
        SftpErrorKind::SocketError,
        SftpErrorKind::SshError,
        SftpErrorKind::ConfigError,
    ];
    let mut codes: Vec<&str> = kinds.iter().map(|kind| kind.as_str()).collect();
    let count = codes.len();
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(codes.len(), count, "коды ошибок не уникальны");

    for code in codes {
        assert!(!code.is_empty());
        assert!(!code.contains('_'), "код {code} должен быть в kebab-case");
        assert!(!code.contains(' '), "код {code} содержит пробел");
        assert_eq!(code, code.to_ascii_lowercase());
    }
}

/// Классификация по префиксу: только `AUTH_FAILURE:` в начале строки
/// означает отказ авторизации. Остальное — обычная ошибка SSH.
#[test]
fn классификация_ошибок_чувствительна_к_префиксу() {
    assert_eq!(classify_error("AUTH_FAILURE: неверный пароль"), SftpErrorKind::AuthFailure);
    assert_eq!(classify_error("AUTH_FAILURE:"), SftpErrorKind::AuthFailure);
    // Префикс не в начале — это не маркер авторизации.
    assert_eq!(classify_error("ошибка: AUTH_FAILURE: пароль"), SftpErrorKind::SshError);
    assert_eq!(classify_error("auth_failure: неверный пароль"), SftpErrorKind::SshError);
    assert_eq!(classify_error(""), SftpErrorKind::SshError);
}

/// Статус соединения сериализуется строкой в kebab-case, которую
/// сравнивает рендерер: смена формата тихо отключила бы обновление UI.
#[test]
fn статус_соединения_сериализуется_строкой() {
    let expected = [
        (SftpStatusKind::Ready, "ready"),
        (SftpStatusKind::ConnectionEnded, "connection-ended"),
        (SftpStatusKind::ConnectionClosed, "connection-closed"),
    ];
    for (kind, code) in expected {
        let event = SftpStatusEvent { kind, message: Some("текст".to_owned()) };
        let json = serde_json::to_value(&event).expect("json");
        assert_eq!(json["kind"], code);
        assert_eq!(json["message"], "текст");
    }

    // Без сообщения поле не отправляется вовсе.
    let event = SftpStatusEvent { kind: SftpStatusKind::Ready, message: None };
    let json = serde_json::to_value(&event).expect("json");
    assert!(json.get("message").is_none(), "пустое сообщение не должно уходить в UI: {json}");
}
