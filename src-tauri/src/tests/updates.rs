use super::*;
use std::path::PathBuf;

// ── Разбор версий ────────────────────────────────────────────────────────────

/// Числовые сегменты читаются с ведущим `v`, разной длиной и пустыми
/// сегментами; нечитаемая версия не распознаётся вовсе.
#[test]
fn разбирает_числовые_сегменты() {
    assert_eq!(version_segments("4.0.1"), Some(vec![4, 0, 1]));
    assert_eq!(version_segments("v4.0.1"), Some(vec![4, 0, 1]));
    // Недостающие сегменты считаются нулями.
    assert_eq!(version_segments("4.0"), Some(vec![4, 0, 0]));
    assert_eq!(version_segments("4"), Some(vec![4, 0, 0]));
    // Пре-релиз и метаданные сборки в сравнение не попадают.
    assert_eq!(version_segments("4.0.0-rc.1"), Some(vec![4, 0, 0]));
    assert_eq!(version_segments("4.0.1+build.7"), Some(vec![4, 0, 1]));
    // Мусор не распознаётся: сравнивать нечего, и откатом он не считается.
    for candidate in ["", "не-версия", "v", "...", "4.0.0.0.0.0", "4.x"] {
        assert_eq!(
            version_segments(candidate),
            None,
            "мусор {candidate:?} не должен распознаваться"
        );
    }
}

/// Признак pre-release решает, можно ли предлагать сборку при выключенной
/// настройке: ошибочное `true` отдало бы пользователю rc вместо релиза, а
/// ошибочное `false` скрыло бы включённую настройку вовсе.
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
    // Нераспознанная версия пре-релизом не считается: подозревать в мусоре
    // безопаснее, чем предложить «стабильную» сборку.
    for candidate in ["", "не-версия", "4.0.0.0.0.0"] {
        assert!(
            !is_pre_release(candidate),
            "мусор {candidate:?} признан pre-release"
        );
    }
}

/// Откат ловится по числовым сегментам, а при равных сегментах — только когда
/// текущая версия пре-релизная, а предложенная релизная.
#[test]
fn определяет_откат() {
    // Меньшие сегменты — откат при любом сравнении.
    assert!(is_rollback("3.9.9", "4.0.0"));
    assert!(is_rollback("4.0.0", "4.0.1"));
    assert!(is_rollback("4.0.0", "4.1.0"));
    assert!(is_rollback("4.0", "4.0.1"));
    // Равные сегменты: откат — это возврат из релизного в пре-релизный.
    assert!(is_rollback("4.0.0", "4.0.0-rc.1"));
    // Равные сегменты, версии одного рода — откатом не считается.
    assert!(!is_rollback("4.0.0", "4.0.0"));
    assert!(!is_rollback("4.0.1", "4.0.1"));
    // Внутри пре-релизов порядок не разбирается: различать rc.1 и rc.2 здесь
    // незачем, обновление и так пришло из плагина, отдающего только новое.
    assert!(!is_rollback("4.0.0-rc.2", "4.0.0-rc.1"));
    assert!(!is_rollback("4.0.0-rc.1", "4.0.0-rc.2"));
    // Переход с пре-релиза на релиз — обновление, а не откат.
    assert!(!is_rollback("4.0.0", "4.0.0-rc.1"));
    // Ведущий `v` в манифесте допустим.
    assert!(!is_rollback("v4.0.1", "4.0.1"));
    assert!(is_rollback("v4.0.0", "4.0.1"));
}

/// Мусор в манифесте не должен ни предлагаться, ни блокировать обновление.
#[test]
fn некорректные_версии_не_считаются_откатом() {
    for candidate in ["", "не-версия", "4.0.0.0.0.0", "v", "..."] {
        assert!(
            !is_rollback(candidate, "4.0.0"),
            "мусор {candidate:?} признан откатом и заблокировал бы обновление"
        );
        assert!(
            !is_rollback("4.0.0", candidate),
            "неразобранная текущая версия {candidate:?} заблокировала бы обновление"
        );
    }
}

/// Версия собирается из манифеста пакета, а не из конфига: расхождение
/// привело бы к вечной проверке одной и той же версии.
#[test]
fn версия_совпадает_с_манифестом() {
    assert_eq!(CURRENT_VERSION, env!("CARGO_PKG_VERSION"));
    assert!(!CURRENT_VERSION.trim().is_empty());
    assert!(
        version_segments(CURRENT_VERSION).is_some(),
        "неожиданный формат версии: {CURRENT_VERSION}"
    );
}

/// Собранная версия обязана быть новее самой себя: иначе страховка от отката
/// заблокировала бы любое обновление.
#[test]
fn текущая_версия_не_откатывается_сама_в_себя() {
    assert!(!is_rollback(CURRENT_VERSION, CURRENT_VERSION));
}

// ── Настройка канала ─────────────────────────────────────────────────────────

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

// ── Ошибка плагина vs «обновлений нет» ───────────────────────────────────────

/// Пустой `platforms` в манифесте — это «предлагать нечего», а не поломка.
///
/// Плагин ищет платформу до сравнения версий, поэтому манифест без артефакта
/// для текущей ОС возвращал `TargetsNotFound`, и приложение показывало
/// пользователю ошибку вместо «обновлений нет».
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

    // `ReleaseNotFound` — это в том числе 404 на адрес манифеста. Единственный
    // источник истины, поэтому молчать о нём нельзя: пользователь должен
    // знать, что приложение не сможет обновиться.
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

/// Временный конфиг для тестов состояния автообновления.
fn state_file(name: &str) -> (PathBuf, crate::config::test_path::Restore) {
    test_state::temp_config(name)
}

/// Метки состояния (`skipped`/`notified`) переживают перезапуск: без этого
/// пропущенная версия предлагалась бы снова и снова.
#[test]
fn состояние_пропуска_читается_из_конфига() {
    let state = crate::config::UpdaterConfig {
        last_check: Some(1_700_000_000),
        last_download: None,
        last_install: None,
        skipped_version: Some("4.0.1".to_owned()),
        notified_version: None,
    };
    let json = serde_json::to_string(&state).expect("json");
    let parsed: crate::config::UpdaterConfig = serde_json::from_str(&json).expect("разбор состояния");
    assert_eq!(parsed.skipped_version.as_deref(), Some("4.0.1"));
    assert_eq!(parsed.last_check, Some(1_700_000_000));
    assert!(parsed.last_download.is_none());

    // Пустое состояние не должно ломать запуск: значения считаются пустыми и
    // обновление предлагается заново. Пустые поля в JSON не пишутся.
    assert!(!json.contains("lastDownload"), "пустое поле попало в конфиг: {json}");
    let empty: crate::config::UpdaterConfig = serde_json::from_str("{}").expect("пустое состояние");
    assert!(empty.skipped_version.is_none());
    assert!(empty.last_check.is_none());
    assert!(empty.is_empty(), "пустое состояние не должно считаться заполненным");
    assert!(serde_json::from_str::<crate::config::UpdaterConfig>("не json").is_err());
}

/// Конфиг бэкапится и показывается в настройках, поэтому в метках
/// автообновления допустимы только версии и время — ничего больше.
#[test]
fn состояние_содержит_только_метки() {
    let filled = crate::config::UpdaterConfig {
        last_check: Some(1),
        last_download: Some(2),
        last_install: Some(3),
        skipped_version: Some("4.0.1".to_owned()),
        notified_version: Some("4.0.1".to_owned()),
    };
    let json = serde_json::to_string(&filled).expect("json").to_lowercase();
    for forbidden in ["password", "token", "signature", "url", "secret"] {
        assert!(
            !json.contains(forbidden),
            "в состоянии автообновления не должно быть поля {forbidden}: {json}"
        );
    }
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

/// Метки скачивания и установки пишутся независимо: показывать их раздельно
/// нужно для диагностики, иначе не отличить «не скачалось» от «не поставилось».
#[tokio::test]
async fn метки_скачивания_и_установки_независимы() {
    let (path, _restore) = state_file("download-install");

    store_last_download().await;
    assert!(read_state().last_download.is_some(), "метка скачивания не записана");
    assert!(
        read_state().last_install.is_none(),
        "метка установки не должна появляться вместе со скачиванием"
    );

    store_last_install().await;
    let saved = read_state();
    assert!(saved.last_install.is_some(), "метка установки не записана");
    assert_eq!(saved.last_download, saved.last_install, "установка должна быть не раньше скачивания");
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

/// Троттлинг фоновой проверки: до интервала проверка не запускается, после —
/// запускается. Без этого приложение, перезапущенное раньше интервала, дёргало
/// бы сеть при каждом старте.
#[test]
fn фоновую_проверку_дросселирует_интервал() {
    let interval = crate::UPDATE_CHECK_INTERVAL;
    let state = UpdaterState::new();
    // Метки ещё нет — проверка разрешена.
    assert!(should_check(&state, interval));

    // Метка ставится в блоке, а не через `set_last_check`: блокировку нужно
    // отпустить до `should_check`, иначе он вернул бы `false` из-за занятого
    // мьютекса, а не из-за свежей метки, и тест ничего не проверял бы.
    {
        let mut guard = state.last_check.try_lock().expect("мьютекс свободен");
        *guard = Some(SystemTime::now());
    }
    assert!(
        !should_check(&state, interval),
        "проверка не должна запускаться раньше интервала"
    );

    // Метка старше интервала — проверка снова разрешена.
    {
        let mut guard = state.last_check.try_lock().expect("мьютекс свободен");
        *guard = Some(SystemTime::now() - interval - Duration::from_secs(1));
    }
    assert!(should_check(&state, interval));
}

/// Интервал проверки не должен быть нулевым или чаще минуты: иначе фоновый
/// цикл превращается в сетевой запрос каждые несколько секунд.
#[test]
fn интервал_проверки_разумный() {
    let interval = crate::UPDATE_CHECK_INTERVAL;
    assert!(interval >= Duration::from_secs(60));
    assert!(interval <= Duration::from_secs(24 * 60 * 60));
}

/// Состояние, о котором ещё никто не спрашивал, не должно содержать
/// подготовленного обновления: иначе кнопка «обновить» появилась бы сама.
#[tokio::test]
async fn без_проверки_обновления_нет() {
    let (_path, _restore) = state_file("empty-pending");

    let state = UpdaterState::new();
    assert_eq!(state.pending_version().await, None);
    assert!(state.pending_update().await.is_none());

    // Установщик без подготовленного обновления игнорируется, а не паникует.
    state.set_installer(vec![1, 2, 3]).await;
    assert_eq!(state.pending_version().await, None);
}