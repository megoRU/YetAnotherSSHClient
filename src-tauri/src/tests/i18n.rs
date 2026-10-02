use super::*;

#[test]
fn ключи_ru_и_en_совпадают() {
    let ru = keys_for("ru");
    let en = keys_for("en");
    assert_eq!(ru, en, "в i18n/main.json наборы ключей ru и en различаются");
    assert!(!ru.is_empty());
}

#[test]
fn язык_нормализуется_до_известного() {
    let _guard = test_guard();
    // Любой неизвестный язык показывается по-русски: интерфейс не должен
    // отдавать пользователю пустые строки или сырые ключи.
    for lang in ["ru", "en", "de", "", "EN", "rus"] {
        set_language(lang);
        let current = language();
        assert!(
            current == "ru" || current == "en",
            "неожиданный язык {current} после set_language({lang:?})"
        );
    }
    set_language("en");
    assert_eq!(language(), "en");
    set_language("ru");
    assert_eq!(language(), "ru");
}

#[test]
fn подстановка_повторяет_только_первое_вхождение() {
    // Параметр подставляется один раз: иначе сообщение с двумя
    // одинаковыми плейсхолдерами разъехалось бы.
    assert_eq!(interpolate("{a} и {a}", &[("a", "X")]), "X и {a}");
    assert_eq!(interpolate("{a} и {b}", &[("a", "X"), ("b", "Y")]), "X и Y");
    // Отсутствующий параметр остаётся плейсхолдером — это видно в логе.
    assert_eq!(interpolate("{a}", &[("b", "Y")]), "{a}");
    assert_eq!(interpolate("без параметров", &[]), "без параметров");
}

#[test]
fn ключ_с_вложенными_секциями_разрешается() {
    let _guard = test_guard();
    set_language("ru");
    // Точечный путь должен доходить до строки, а не возвращаться целиком.
    let text = t("errors.socketError", &[]);
    assert_ne!(text, "errors.socketError");
    assert!(!text.contains('.'), "в сообщении остался путь ключа: {text}");
}

#[test]
fn ключи_обоих_языков_непустые_и_уникальные() {
    for lang in ["ru", "en"] {
        let keys = keys_for(lang);
        assert!(!keys.is_empty());
        let mut unique = keys.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), keys.len(), "в словаре {lang} есть повторяющиеся ключи");
        // Плоская карта используется для проверки паритета значений.
        assert_eq!(flat_map(lang).len(), keys.len());
    }
}

#[test]
fn подставляет_параметры() {
    let _guard = test_guard();
    set_language("en");
    assert_eq!(
        t("errors.socketError", &[("message", "boom")]),
        "Socket error: boom"
    );
    set_language("ru");
    assert_eq!(
        t("errors.socketError", &[("message", "boom")]),
        "Ошибка сокета: boom"
    );
}

#[test]
fn неизвестный_ключ_возвращается_как_есть() {
    let _guard = test_guard();
    set_language("ru");
    assert_eq!(t("no.such.key", &[]), "no.such.key");
}
