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

// ── Ошибка плагина vs «обновлений нет» ───────────────────────────────────────

/// Пустой `platforms` в манифесте — это «предлагать нечего», а не поломка.
///
/// Плагин ищет платформу до сравнения версий, поэтому заглушка
/// (`version: 0.0.0`, `platforms: {}`) возвращала `TargetsNotFound`, и
/// приложение показывало пользователю ошибку вместо «обновлений нет».
#[test]
fn пустой_манифест_не_ошибка() {
    use tauri_plugin_updater::Error;

    assert!(
        is_no_update_error(&Error::TargetNotFound("windows-x86_64".to_owned())),
        "платформы нет в манифесте — это штатное «обновлений нет»"
    );
    assert!(
        is_no_update_error(&Error::TargetsNotFound(vec!["windows-x86_64".to_owned()])),
        "ни платформы, ни fallback — тоже «обновлений нет»"
    );
}

/// Настоящие сбои обновления обязаны остаться ошибками: о них пользователю
/// есть что сказать, иначе проверка молча выглядела бы успешной.
#[test]
fn сбой_обновления_остаётся_ошибкой() {
    use tauri_plugin_updater::Error;

    assert!(!is_no_update_error(&Error::ReleaseNotFound), "битый endpoint должен быть виден");
    assert!(
        !is_no_update_error(&Error::Network("соединение сброшено".to_owned())),
        "обрыв сети должен быть виден"
    );
    assert!(
        !is_no_update_error(&Error::UnsupportedOs),
        "неподдерживаемая ОС — это ошибка сборки, её нельзя скрывать"
    );
    assert!(
        !is_no_update_error(&Error::EmptyEndpoints),
        "endpoint не задан — это ошибка конфигурации"
    );
}

// ── Состояние переживает перезапуск ───────────────────────────────────────────

/// Временный файл состояния автообновления на время теста.
///
/// Подмена пути — процесс-глобальная, поэтому тесты с файлом сериализуются
/// блокировкой внутри `test_state`.
fn state_file(name: &str) -> (PathBuf, test_state::Restore) {
    let dir = std::env::temp_dir().join("yassh-updater-tests");
    std::fs::create_dir_all(&dir).expect("каталог временных файлов");
    let path = dir.join(format!("{name}-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let restore = test_state::use_file(path.clone());
    (path, restore)
}

/// `update-available` не должен приходить повторно после перезапуска.
///
/// Раньше `notifiedVersion` только читался из файла, но никогда туда не
/// записывался: состояние жило в памяти, и каждое новое запуска приложения
/// снова показывало уведомление об уже известной версии.
#[tokio::test]
async fn уведомление_не_повторяется_после_перезапуска() {
    let (path, _restore) = state_file("notified");

    // Первый запуск: сообщили о версии.
    let first = UpdaterState::new();
    assert_eq!(first.notified_version().await, None);
    first.set_notified("4.0.1").await;
    assert_eq!(first.notified_version().await.as_deref(), Some("4.0.1"));

    // Второй запуск: состояние создаётся заново, как при перезапуске.
    let second = UpdaterState::new();
    assert_eq!(
        second.notified_version().await.as_deref(),
        Some("4.0.1"),
        "после перезапуска версия потеряна — уведомление повторится"
    );

    // И новая версия обязана уведомить снова.
    assert_ne!(second.notified_version().await.as_deref(), Some("4.0.2"));
    let raw = std::fs::read_to_string(&path).expect("файл состояния");
    assert!(raw.contains("\"notifiedVersion\": \"4.0.1\""), "метка не записана: {raw}");
}

/// Отклонённая версия тоже должна переживать перезапуск — иначе «пропустить»
/// работало бы только до перезапуска приложения.
#[tokio::test]
async fn пропущенная_версия_переживает_перезапуск() {
    let (_path, _restore) = state_file("skipped");

    let first = UpdaterState::new();
    first.set_skipped(Some("4.0.1".to_owned())).await;
    assert_eq!(first.skipped_version().await.as_deref(), Some("4.0.1"));

    let second = UpdaterState::new();
    assert_eq!(
        second.skipped_version().await.as_deref(),
        Some("4.0.1"),
        "пропущенная версия не сохранилась"
    );

    // Снятие пропуска возвращает возможность предложить обновление снова.
    second.set_skipped(None).await;
    assert_eq!(UpdaterState::new().skipped_version().await, None);
}

/// Запись одной метки не затирает остальное состояние: файл переписывается
/// целиком, поэтому терять `lastCheck` нельзя — иначе фоновая проверка
/// повторялась бы на каждом запуске.
#[tokio::test]
async fn запись_меток_не_затирает_остальное_состояние() {
    let (path, _restore) = state_file("marks");

    set_last_check(&UpdaterState::new());
    assert!(read_state_file().last_check.is_some(), "метка проверки не записана");

    let state = UpdaterState::new();
    state.set_notified("4.0.1").await;
    state.set_skipped(Some("4.0.0".to_owned())).await;

    let saved = read_state_file();
    assert!(saved.last_check.is_some(), "lastCheck потерян при записи notifiedVersion");
    assert_eq!(saved.notified_version.as_deref(), Some("4.0.1"));
    assert_eq!(saved.skipped_version.as_deref(), Some("4.0.0"));

    // Повторная запись того же значения не должна трогать файл зря.
    let before = std::fs::read_to_string(&path).expect("файл состояния");
    store_notified_version("4.0.1");
    assert_eq!(std::fs::read_to_string(&path).expect("файл состояния"), before);
}

/// Битый файл состояния не должен мешать запуску: значения считаются пустыми,
/// приложение просто предложит обновление заново.
#[tokio::test]
async fn битое_состояние_не_ломает_запуск() {
    let (path, _restore) = state_file("broken");
    std::fs::write(&path, "{ это не json").expect("запись мусора");

    let state = UpdaterState::new();
    assert_eq!(state.notified_version().await, None);
    assert_eq!(state.skipped_version().await, None);
}
