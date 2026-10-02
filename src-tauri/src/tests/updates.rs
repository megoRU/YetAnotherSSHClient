use super::*;
use std::path::PathBuf;

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

// ── Каналы: стабильный и pre-release ─────────────────────────────────────────

/// Определение pre-release решает, можно ли предлагать сборку при выключенной
/// настройке: ошибочное `true` отдало бы пользователю rc вместо релиза, а
/// ошибочное `false` — не показало бы включённую настройку вовсе.
#[test]
fn определяет_пре_релизную_версию() {
    assert!(is_pre_release("4.1.0-rc.1"));
    assert!(is_pre_release("v4.1.0-beta"));
    assert!(is_pre_release("4.1.0-alpha.2"));
    assert!(!is_pre_release("4.1.0"));
    assert!(!is_pre_release("v4.1.0"));
    // Метаданные сборки (`+sha`) суффиксом пре-релиза не считаются.
    assert!(!is_pre_release("4.1.0+build.7"));
    assert!(is_pre_release("4.1.0-rc.1+build.7"));
    // Нераспознанная версия не должна считаться pre-release: подозревать в
    // мусоре безопаснее, чем предложить «стабильную» сборку.
    for candidate in ["", "не-версия", "4.0.0.0.0.0"] {
        assert!(
            !is_pre_release(candidate),
            "мусор {candidate:?} признан pre-release"
        );
    }
}

/// Настройка переносится вместе с конфигом и по умолчанию выключена:
/// иначе обновление начало бы приходить в rc без согласия пользователя.
#[test]
fn настройка_пре_релиза_по_умолчанию_выключена() {
    assert!(!crate::config::default_config().allow_pre_release_updates);

    // Старый конфиг без поля читается с дефолтом, а не падает.
    let parsed: crate::config::AppConfig =
        serde_json::from_str("{}").expect("конфиг без полей пре-релиза");
    assert!(!parsed.allow_pre_release_updates);
}

/// Неопубликованный манифест pre-release — это `404`, а не сбой: плагин
/// возвращает `ReleaseNotFound`, и без отдельной классификации пользователь
/// видел бы ошибку вместо обычной проверки стабильного канала.
#[test]
fn отсутствие_манифеста_отличается_от_сбоя() {
    use tauri_plugin_updater::Error;

    assert!(
        matches!(classify_error(&Error::ReleaseNotFound), ChannelError::Missing),
        "неопубликованный манифест должен приводить к откату на стабильный канал"
    );
    assert!(
        matches!(classify_error(&Error::Network("обрыв".to_owned())), ChannelError::Failed(_)),
        "обрыв сети обязан оставаться ошибкой"
    );

    // Сообщение для пользователя не должно быть пустым ни в одной из веток.
    assert!(!ChannelError::Missing.into_message().is_empty());
    assert_eq!(ChannelError::Failed("текст".to_owned()).into_message(), "текст");
}

/// Состояние автообновления (`skipped`/`seen`) переживает перезапуск:
/// без этого пропущенная версия предлагалась бы снова и снова.
#[test]
fn состояние_пропуска_читается_из_конфига() {
    let state = crate::config::UpdaterState {
        last_check: Some(1_700_000_000),
        last_download: None,
        last_install: None,
        skipped_version: Some("4.0.1".to_owned()),
        notified_version: None,
    };
    let json = serde_json::to_string(&state).expect("json");
    let parsed: crate::config::UpdaterState = serde_json::from_str(&json).expect("разбор состояния");
    assert_eq!(parsed.skipped_version.as_deref(), Some("4.0.1"));
    assert_eq!(parsed.last_check, Some(1_700_000_000));
    assert!(parsed.last_download.is_none());

    // Пустое состояние не должно ломать запуск: значения считаются пустыми и
    // обновление предлагается заново. Пустые поля в JSON не пишутся.
    assert!(!json.contains("lastDownload"), "пустое поле попало в конфиг: {json}");
    let empty: crate::config::UpdaterState = serde_json::from_str("{}").expect("пустое состояние");
    assert!(empty.skipped_version.is_none());
    assert!(empty.last_check.is_none());
    assert!(empty.is_empty(), "пустое состояние не должно считаться заполненным");
    assert!(serde_json::from_str::<crate::config::UpdaterState>("не json").is_err());
}

/// Старый `~/.minissh_updater.json` переносится в конфиг один раз и удаляется.
///
/// Файл создавался только ради служебных меток, поэтому после переноса он
/// удаляется: иначе он оставался бы вторым источником состояния, а бэкап
/// конфига — неполным.
#[test]
fn состояние_переносится_из_старого_файла_один_раз() {
    let path = legacy_state_file("migrate");
    std::fs::write(&path, r#"{"lastCheck": 1790879620140, "skippedVersion": "4.0.1"}"#)
        .expect("запись старого состояния");

    let mut config = crate::config::default_config();
    assert!(migrate_from_path(&path, &mut config), "состояние не перенесено");

    let state = config.updater.as_ref().expect("состояние в конфиге");
    assert_eq!(state.last_check, Some(1_790_879_620_140));
    assert_eq!(state.skipped_version.as_deref(), Some("4.0.1"));
    assert!(!path.exists(), "старый файл не удалён после миграции");

    // Повторный запуск ничего не делает: файла уже нет.
    assert!(!migrate_from_path(&path, &mut config), "миграция повторилась без файла");
}

/// Уже сохранённое в конфиге значение не затирается данными из старого файла:
/// конфиг — источник истины, файл мог остаться от более ранней сборки.
#[test]
fn миграция_не_затирает_значения_из_конфига() {
    let path = legacy_state_file("migrate-keep");
    std::fs::write(&path, r#"{"lastCheck": 111, "skippedVersion": "4.0.0"}"#).expect("запись");

    let mut config = crate::config::default_config();
    config.updater = Some(crate::config::UpdaterState {
        last_check: Some(222),
        last_download: None,
        last_install: None,
        skipped_version: Some("4.0.5".to_owned()),
        notified_version: None,
    });

    assert!(migrate_from_path(&path, &mut config));
    let state = config.updater.expect("состояние в конфиге");
    assert_eq!(state.last_check, Some(222), "старое значение затёрло актуальное");
    assert_eq!(state.skipped_version.as_deref(), Some("4.0.5"));
}

/// Повреждённый старый файл не должен помешать запуску: он удаляется, а
/// состояние считается пустым.
#[test]
fn битый_старый_файл_не_ломает_миграцию() {
    let path = legacy_state_file("migrate-broken");
    std::fs::write(&path, "{ это не json").expect("запись мусора");

    let mut config = crate::config::default_config();
    assert!(!migrate_from_path(&path, &mut config), "мусор не должен давать состояние");
    assert!(config.updater.is_none());
    assert!(!path.exists(), "битый файл должен быть убран");
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

/// Старый файл состояния автообновления для проверки миграции.
///
/// Миграция читает и удаляет файл, поэтому он должен быть отдельным на каждый
/// тест и лежать во временном каталоге: настоящий `~/.minissh_updater.json`
/// трогать нельзя.
fn legacy_state_file(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("yassh-updater-legacy");
    std::fs::create_dir_all(&dir).expect("каталог временных файлов");
    let path = dir.join(format!("{name}-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path
}

/// Временный конфиг для тестов состояния автообновления.
fn state_file(name: &str) -> (PathBuf, crate::config::test_path::Restore) {
    test_state::temp_config(name)
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
    let raw = std::fs::read_to_string(&path).expect("файл конфига");
    assert!(raw.contains("\"notifiedVersion\": \"4.0.1\""), "метка не записана: {raw}");
    let _ = std::fs::remove_file(&path);
}

/// Отклонённая версия тоже должна переживать перезапуск — иначе «пропустить»
/// работало бы только до перезапуска приложения.
#[tokio::test]
async fn пропущенная_версия_переживает_перезапуск() {
    let (path, _restore) = state_file("skipped");

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
    let _ = std::fs::remove_file(&path);
}

/// Запись одной метки не затирает остальное состояние: файл переписывается
/// целиком, поэтому терять `lastCheck` нельзя — иначе фоновая проверка
/// повторялась бы на каждом запуске.
#[tokio::test]
async fn запись_меток_не_затирает_остальное_состояние() {
    let (path, _restore) = state_file("marks");

    set_last_check(&UpdaterState::new()).await;
    assert!(read_state().last_check.is_some(), "метка проверки не записана");

    let state = UpdaterState::new();
    state.set_notified("4.0.1").await;
    state.set_skipped(Some("4.0.0".to_owned())).await;

    let saved = read_state();
    assert!(saved.last_check.is_some(), "lastCheck потерян при записи notifiedVersion");
    assert_eq!(saved.notified_version.as_deref(), Some("4.0.1"));
    assert_eq!(saved.skipped_version.as_deref(), Some("4.0.0"));

    // Повторная запись того же значения не должна трогать конфиг зря.
    let before = std::fs::read_to_string(&path).expect("файл конфига");
    store_notified_version("4.0.1").await;
    assert_eq!(std::fs::read_to_string(&path).expect("файл конфига"), before);
    let _ = std::fs::remove_file(&path);
}

/// Повреждённый конфиг не должен мешать запуску: значения считаются пустыми,
/// приложение просто предложит обновление заново.
#[tokio::test]
async fn битое_состояние_не_ломает_запуск() {
    let (path, _restore) = state_file("broken");
    std::fs::write(&path, "{ это не json").expect("запись мусора");
    crate::config::clear_cache();

    let state = UpdaterState::new();
    assert_eq!(state.notified_version().await, None);
    assert_eq!(state.skipped_version().await, None);
    let _ = std::fs::remove_file(&path);
}
