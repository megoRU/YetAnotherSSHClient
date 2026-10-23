use super::*;

/// Ключ из общего UI-словаря.
const KEY_EXISTS: &str = "terminal.authFailed";

#[test]
fn локализованный_текст_не_переводится_повторно() {
    let error = AppError::Localized("уже переведено".to_owned());
    assert_eq!(error.localized(), "уже переведено");
    assert_eq!(error.to_string(), "уже переведено");
}

#[test]
fn ключ_переводится_через_словарь() {
    let error = AppError::Key(KEY_EXISTS);
    assert_eq!(error.localized(), i18n::t(KEY_EXISTS, &[]));
    // UI-мост заменяет маркер текстом из выбранной локали.
    assert_ne!(error.localized(), KEY_EXISTS);
}

#[test]
fn неизвестный_ключ_не_паникует() {
    // Отсутствующий ключ не должен ронять команду: UI покажет имя ключа.
    let error = AppError::Key("errors.noSuchKey");
    assert!(!error.localized().is_empty());
}

#[test]
fn внутренняя_ошибка_показывает_fallback_а_не_технический_текст() {
    let error = AppError::with_source(KEY_EXISTS, "connection reset by peer");
    assert_eq!(error.localized(), i18n::t(KEY_EXISTS, &[]));
    assert!(!error.localized().contains("connection reset"));
}

#[test]
fn сериализуется_строкой_а_не_объектом() {
    // IPC сохраняет совместимость с вызовами, которые ждут строку при catch.
    let json = serde_json::to_string(&AppError::Localized("текст".to_owned())).expect("json");
    assert_eq!(json, "\"текст\"");

    let json = serde_json::to_string(&AppError::Key(KEY_EXISTS)).expect("json");
    assert_eq!(json, format!("\"{}\"", i18n::t(KEY_EXISTS, &[])));
}

#[test]
fn ошибки_из_строк_считаются_локализованными() {
    assert!(matches!(AppError::from("текст"), AppError::Localized(_)));
    assert!(matches!(AppError::from(String::from("текст")), AppError::Localized(_)));
}
