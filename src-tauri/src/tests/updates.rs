use super::*;

#[test]
fn сравнивает_версии() {
    assert!(is_newer_version("4.0.1", "4.0.0"));
    assert!(is_newer_version("4.1.0", "4.0.9"));
    assert!(!is_newer_version("4.0.0", "4.0.0"));
    assert!(!is_newer_version("3.9.9", "4.0.0"));
    assert!(is_newer_version("v4.0.0", "3.9.9"));
    assert!(!is_newer_version("4.0.0-rc.1", "4.0.0"));
    assert!(is_newer_version("4.0.0", "4.0.0-rc.1"));
}

#[test]
fn версия_приложения_из_манифеста() {
    assert!(!CURRENT_VERSION.is_empty());
    assert!(CURRENT_VERSION.starts_with('4'), "ветка dev-v4.0.0");
}

#[test]
fn заглушка_ключа_распознаётся() {
    let pubkey = "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER";
    assert!(pubkey.contains(PUBKEY_PLACEHOLDER));
}

/// Сравнение версий — основа «новое обновление есть / нет»: разбор
/// пре-релизов и ведущего `v` обязан работать, иначе пользователю
/// предлагается откат или предрелиз вместо релиза.
#[test]
fn сравнение_версий_учитывает_пре_релизы() {
    // Патч и минор.
    assert!(is_newer_version("4.0.1", "4.0.0"));
    assert!(is_newer_version("4.1.0", "4.0.9"));
    assert!(is_newer_version("5.0.0", "4.9.9"));
    // Релиз новее своей пре-версии; пре-версии сравниваются между собой.
    assert!(is_newer_version("4.0.0", "4.0.0-rc.1"));
    assert!(is_newer_version("4.0.0-rc.2", "4.0.0-rc.1"));
    assert!(!is_newer_version("4.0.0-rc.1", "4.0.0-rc.2"));
    assert!(!is_newer_version("4.0.0-rc.1", "4.0.0-rc.1"), "равные версии не считаются новыми");
    // По semver: буквенный идентификатор младше числового.
    assert!(is_newer_version("4.0.0-rc.1", "4.0.0-beta"));
    // Ведущий `v` в манифесте допустим.
    assert!(is_newer_version("v4.0.1", "4.0.0"));
    assert!(!is_newer_version("v4.0.0", "4.0.0"));
    // Разные длины сегментов: 4.0 против 4.0.1.
    assert!(is_newer_version("4.0.1", "4.0"));
    assert!(!is_newer_version("4.0", "4.0.1"));
}

/// Мусор в манифесте не должен приводить к предложению «обновление до
/// пустой версии»: такое сравнение обязано быть консервативным.
#[test]
fn некорректные_версии_не_считаются_новыми() {
    for candidate in ["", "не-версия", "4.0.0.0.0.0", "v", "..."] {
        assert!(
            !is_newer_version(candidate, "4.0.0"),
            "мусор {candidate:?} признан новой версией"
        );
    }
}

/// Состояние автообновления (`skipped`/`seen`) переживает перезапуск:
/// без этого пропущенная версия предлагалась бы снова и снова.
#[test]
fn состояние_пропуска_читается_из_файла() {
    let state = UpdaterStateFile {
        last_check: Some(1_700_000_000),
        last_download: None,
        last_install: None,
        skipped_version: Some("4.0.1".to_owned()),
        notified_version: None,
    };
    let json = serde_json::to_string(&state).expect("json");
    let parsed: UpdaterStateFile = serde_json::from_str(&json).expect("разбор состояния");
    assert_eq!(parsed.skipped_version.as_deref(), Some("4.0.1"));
    assert_eq!(parsed.last_check, Some(1_700_000_000));
    assert!(parsed.last_download.is_none());

    // Пустой файл не должен ломать запуск: состояние считается пустым и
    // обновление предлагается заново. Пустые поля в JSON не пишутся.
    assert!(!json.contains("lastDownload"), "пустое поле попало в файл: {json}");
    let empty: UpdaterStateFile = serde_json::from_str("{}").expect("пустое состояние");
    assert!(empty.skipped_version.is_none());
    assert!(empty.last_check.is_none());
    assert!(serde_json::from_str::<UpdaterStateFile>("не json").is_err());
}

/// Версия собирается из манифеста пакета, а не из конфига: расхождение
/// привело бы к вечной проверке одной и той же версии.
#[test]
fn версия_совпадает_с_манифестом() {
    assert_eq!(CURRENT_VERSION, env!("CARGO_PKG_VERSION"));
    assert!(!CURRENT_VERSION.trim().is_empty());
    // Три числовых сегмента без префикса: так её понимает semver-разбор.
    assert!(
        CURRENT_VERSION.split('.').count() >= 3,
        "неожиданный формат версии: {CURRENT_VERSION}"
    );
}
