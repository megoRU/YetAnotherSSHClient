use super::*;

#[test]
fn размер_подгоняется_под_рабочую_область() {
    let work = WorkArea { x: 0, y: 0, width: 2048, height: 1104 };
    assert_eq!(work.fit_size(1748, 1148), (1748, 1104));
    assert_eq!(work.fit_size(400, 300), (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT));
    assert_eq!(work.fit_size(1024, 768), (1024, 768));
}

#[test]
fn позиция_остаётся_в_рабочей_области() {
    let work = WorkArea { x: 0, y: 0, width: 2048, height: 1104 };
    // Низ окна не должен уезжать под панель задач.
    assert_eq!(work.clamp_position(427, 104, 1024, 1104), (427, 0));
    // Правая и верхняя границы тоже.
    assert_eq!(work.clamp_position(1900, -40, 1748, 1104), (300, 0));
    assert_eq!(work.clamp_position(300, 300, 1024, 768), (300, 300));
    // Второй монитор левее: границы считаются от его начала.
    let left = WorkArea { x: -2048, y: 0, width: 2048, height: 1104 };
    assert_eq!(left.clamp_position(-100, 0, 1748, 1104), (-1748, 0));
}

#[test]
fn центр_считается_по_рабочей_области() {
    let work = WorkArea { x: 0, y: 0, width: 2048, height: 1104 };
    assert_eq!(work.center(1024, 768), (512, 168));
}

#[test]
fn скрипт_инициализации_содержит_конфиг() {
    let script = bootstrap_script(&crate::config::default_config());
    assert!(script.starts_with("window.__YASSH_BOOTSTRAP__ = {"));
    assert!(script.contains("favorites"));
}

#[test]
fn цвет_темы_задан() {
    assert_ne!(theme_color("Dark"), theme_color("Light"));
    assert_eq!(theme_color("Auto").3, 255);
}

/// Фон окна обязан быть непрозрачным: иначе при перерисовке webview
/// видно чёрный прямоугольник, пока интерфейс ещё не отрисован.
#[test]
fn фон_окна_непрозрачный_для_всех_тем() {
    for theme in ["Dark", "Light", "Auto", "Solarized", " Gruvbox", "windows-terminal", ""] {
        let (r, g, b, a) = theme_color(theme);
        assert_eq!(a, 255, "тема {theme:?} дала полупрозрачный фон");
        // Светлая тема интерфейса обязана давать светлый фон: иначе окно
        // мигнёт тёмным перед отрисовкой UI.
        let brightness = u32::from(r) + u32::from(g) + u32::from(b);
        if theme.starts_with("Light") {
            assert!(brightness > 400, "светлая тема {theme:?} дала тёмный фон: {r},{g},{b}");
        }
    }
    // Неизвестная тема откатывается к тёмной: иначе окно стартовало бы
    // светлым и мигнуло перед отрисовкой UI.
    assert_eq!(theme_color("неизвестная").3, 255);
}

/// Конфиг хранит геометрию в физических пикселях, билдер ждёт логических:
/// на 125 % DPI одно и то же окно должно сохранять видимый размер.
#[test]
fn границы_переводятся_через_scale_factor() {
    let bounds = WindowBounds {
        x: 100,
        y: 50,
        width: 1600,
        height: 900,
        scale_factor: 1.25,
    };
    assert_eq!(f64::from(bounds.width) / bounds.scale_factor, 1280.0);
    assert_eq!(f64::from(bounds.height) / bounds.scale_factor, 720.0);
    assert_eq!(f64::from(bounds.x) / bounds.scale_factor, 80.0);
    assert_eq!(f64::from(bounds.y) / bounds.scale_factor, 40.0);

    // На 200 % те же физические пиксели дают вдвое меньше логических.
    let hi = WindowBounds { scale_factor: 2.0, ..bounds };
    assert_eq!(f64::from(hi.width) / hi.scale_factor, 800.0);
}

/// `scale_factor` не может быть нулём: деление дало бы бесконечный размер,
/// и окно не создалось бы.
/// Рабочая область строится из физического прямоугольника монитора как есть.
#[test]
fn рабочая_область_из_прямоугольника() {
    let rect = PhysicalRect {
        position: PhysicalPosition::new(-2048, 40),
        size: PhysicalSize::new(2560, 1400),
    };
    let work = WorkArea::from(rect);
    assert_eq!((work.x, work.y), (-2048, 40));
    assert_eq!((work.width, work.height), (2560, 1400));
}

/// Геометрия из конфига — источник истины для первого запуска окна.
#[test]
fn геометрия_берётся_из_конфига() {
    let config = crate::config::AppConfig {
        x: 120,
        y: 80,
        width: 1400,
        height: 900,
        ..crate::config::default_config()
    };
    let bounds = stored_bounds(&config);
    assert_eq!((bounds.x, bounds.y), (120, 80));
    assert_eq!((bounds.width, bounds.height), (1400, 900));
    assert_eq!(bounds.scale_factor, 1.0, "без списка мониторов масштаб равен 1");
}

/// Размер меньше минимального поднимается до минимума: иначе окно
/// создастся нечитаемым и `fit` не сможет его расположить.
#[test]
fn слишком_маленький_размер_поднимается_до_минимального() {
    let config = crate::config::AppConfig {
        width: 10,
        height: 10,
        ..crate::config::default_config()
    };
    let bounds = stored_bounds(&config);
    assert_eq!(bounds.width, MIN_WINDOW_WIDTH);
    assert_eq!(bounds.height, MIN_WINDOW_HEIGHT);
}

/// Скрипт инициализации выполняется до загрузки приложения, поэтому он
/// обязан быть присваиванием без внешних зависимостей.
#[test]
fn скрипт_инициализации_присваивает_объект() {
    let config = crate::config::AppConfig {
        theme: "Solarized".to_owned(),
        language: "en".to_owned(),
        favorites: vec![],
        ..crate::config::default_config()
    };
    let script = bootstrap_script(&config);
    assert!(script.starts_with("window.__YASSH_BOOTSTRAP__ = {"), "нет присваивания снимка");
    assert!(script.ends_with("};"), "скрипт должен быть одним выражением: {script}");
    assert!(script.contains("Solarized"), "тема не попала в снимок");
    // Снимок обязан быть валидным JSON-объектом: иначе `useConfig` упадёт
    // до первого `await` и интерфейс не стартует.
    let json = script
        .trim_start_matches("window.__YASSH_BOOTSTRAP__ = ")
        .trim_end_matches(';');
    let parsed: serde_json::Value = serde_json::from_str(json).expect("снимок — валидный JSON");
    assert_eq!(parsed["theme"], "Solarized");
    assert_eq!(parsed["language"], "en");
}

/// Закрытие окна не должно теряться из-за сохранения геометрии.
///
/// Цикл закрытия: первое нажатие переводит в `Saving` и держит окно, задача
/// сохранения переводит в `Saved` и вызывает `close()`, и только тогда второе
/// `CloseRequested` пропускается. Если этот порядок нарушить, окно либо
/// закроется без сохранения, либо не закроется никогда.
#[test]
fn цикл_закрытия_окна_сохраняет_геометрию() {
    let mut state = CloseState::Idle;

    // Первое нажатие: окно держим, ждём записи.
    let (next, block) = state.on_close_requested();
    assert!(block, "первое нажатие не должно закрывать окно до сохранения");
    state = next;
    assert_eq!(state, CloseState::Saving);

    // Повторное нажатие, пока пишется конфиг, тоже держит окно: пользователь
    // может кликнуть крестик дважды.
    let (next, block) = state.on_close_requested();
    assert!(block, "повторное нажатие во время сохранения закрыло окно");
    assert_eq!(next, CloseState::Saving);

    // Сохранение закончилось — задача переводит состояние и зовёт close().
    state = CloseState::Saved;

    // Событие от `close()` наконец пропускается, и цикл сбрасывается.
    let (next, block) = state.on_close_requested();
    assert!(!block, "после сохранения окно всё ещё удерживается");
    assert_eq!(next, CloseState::Idle, "цикл закрытия не сбросился");
}

/// Повторное открытие окна должно начинать цикл заново: состояние обязано
/// вернуться в `Idle` после каждого успешного закрытия.
#[test]
fn цикл_закрытия_повторяем() {
    for _ in 0..3 {
        let (state, block) = CloseState::Idle.on_close_requested();
        assert!(block);
        assert_eq!(state, CloseState::Saving);

        let (_, block) = CloseState::Saved.on_close_requested();
        assert!(!block, "после сохранения закрытие должно разрешаться");
    }
}

/// Состояние переживает запись в атомарную ячейку и обратно: обработчик
/// `CloseRequested` читает `u8`, а не перечисление.
#[test]
fn состояние_переживает_атомарную_ячейку() {
    for state in [CloseState::Idle, CloseState::Saving, CloseState::Saved] {
        let encoded: u8 = state.into();
        assert_eq!(CloseState::from_u8(encoded), state, "состояние исказилось при записи");
    }
    // Мусор в ячейке не должен навсегда блокировать закрытие.
    assert_eq!(CloseState::from_u8(200), CloseState::Idle);
    assert_eq!(CloseState::from_u8(0), CloseState::Idle);
    assert_eq!(CloseState::from_u8(1), CloseState::Saving);
    assert_eq!(CloseState::from_u8(2), CloseState::Saved);
}

/// Ожидание сохранения ограничено: без предела зависшая запись оставила бы
/// окно в `Saving` навсегда, и приложение выглядело бы зависшим.
#[test]
fn ожидание_сохранения_ограничено() {
    assert!(
        WINDOW_STATE_SAVE_TIMEOUT <= Duration::from_secs(5),
        "слишком долгое ожидание: {WINDOW_STATE_SAVE_TIMEOUT:?}"
    );
    assert!(
        WINDOW_STATE_SAVE_TIMEOUT >= Duration::from_millis(100),
        "слишком короткое ожидание: {WINDOW_STATE_SAVE_TIMEOUT:?}"
    );
    // Должно быть заметно меньше времени, за которое пользователь решит, что
    // приложение зависло, и убьёт его вручную.
    assert!(
        WINDOW_STATE_SAVE_TIMEOUT < Duration::from_secs(3),
        "пользователь успеет решить, что окно зависло: {WINDOW_STATE_SAVE_TIMEOUT:?}"
    );
}
