use super::*;

/// Ключ из словаря бэкенда: `i18n/main.json`.
const KEY_EXISTS: &str = "terminal.authFailed";

#[test]
fn локализованный_текст_не_переводится_повторно() {
    let error = AppError::Localized("уже переведено".to_owned());
    assert_eq!(error.localized(), "уже переведено");
    assert_eq!(error.to_string(), "уже переведено");
}

#[test]
fn ключ_переводится_через_словарь() {
    // Язык общий для процесса: держим блокировку, иначе соседний тест
    // переключит язык и сравнение перестанет иметь смысл.
    let _guard = i18n::test_guard();
    let error = AppError::Key(KEY_EXISTS);
    assert_eq!(error.localized(), i18n::t(KEY_EXISTS, &[]));
    // В UI уходит перевод, а не сам ключ.
    assert_ne!(error.localized(), KEY_EXISTS);
}

#[test]
fn неизвестный_ключ_не_паникует() {
    let _guard = i18n::test_guard();
    // Отсутствующий ключ не должен ронять команду: показываем сам ключ,
    // чтобы ошибка была видна в логе поддержки.
    let error = AppError::Key("errors.noSuchKey");
    assert!(!error.localized().is_empty());
}

#[test]
fn внутренняя_ошибка_показывает_fallback_а_не_технический_текст() {
    let _guard = i18n::test_guard();
    let error = AppError::with_source(KEY_EXISTS, "connection reset by peer");
    assert_eq!(error.localized(), i18n::t(KEY_EXISTS, &[]));
    assert!(!error.localized().contains("connection reset"));
}

#[test]
fn сериализуется_строкой_а_не_объектом() {
    let _guard = i18n::test_guard();
    // Фронтенд делает `catch (e) => e` и ждёт строку.
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
