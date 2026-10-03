//! Окно приложения — порт `createWindow` и `saveWindowState` из
//! `electron/main.ts`.
//!
//! Окно frameless (`decorations: false`), минимальный размер 800×500, показ
//! только после готовности рендерера, сохранение геометрии с дебаунсом 500 мс.
//!
//! Геометрия хранится в физических пикселях и по частям окна, которые умеет
//! вернуть Tauri: размер — по клиентской области (`set_size` в Tauri — это
//! `set_inner_size`), позиция — по внешней рамке (`set_position` — это
//! `set_outer_position`). У frameless-окна на Windows внешняя рамка шире
//! клиентской области на невидимые 8 px по бокам и снизу, и подмена одной
//! другой на каждом запуске раздувала окно на 16×9 px.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, WindowEvent};

use crate::config::AppConfig;
use crate::logger;

/// Минимальный размер окна.
pub const MIN_WINDOW_WIDTH: u32 = 800;
pub const MIN_WINDOW_HEIGHT: u32 = 500;

/// Метка главного окна.
pub const MAIN_WINDOW: &str = "main";

/// Состояние окна между вызовами обработчиков.
pub struct WindowState {
    /// Рендерер сообщил о готовности контента.
    pub renderer_content_ready: bool,
    /// Страница загрузилась.
    pub page_loaded: bool,
    /// Размер окна доведён до сохранённого (или попытка подгонки исчерпана).
    pub startup_size_applied: bool,
    /// Окно уже показано (задачи после показа стартуют один раз).
    pub shown: bool,
    /// Отложенное сохранение геометрии.
    pub save_pending: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        WindowState {
            renderer_content_ready: false,
            page_loaded: false,
            startup_size_applied: false,
            shown: false,
            save_pending: false,
        }
    }
}

/// Рабочая область монитора в физических пикселях.
#[derive(Debug, Clone, Copy)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl From<PhysicalRect<i32, u32>> for WorkArea {
    fn from(rect: PhysicalRect<i32, u32>) -> Self {
        WorkArea {
            x: rect.position.x,
            y: rect.position.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }
}

impl WorkArea {
    /// Подгоняет размер окна под рабочую область (не меньше минимального).
    fn fit_size(&self, width: u32, height: u32) -> (u32, u32) {
        (
            width.min(self.width).max(MIN_WINDOW_WIDTH),
            height.min(self.height).max(MIN_WINDOW_HEIGHT),
        )
    }

    /// Сдвигает окно так, чтобы оно целиком помещалось в рабочую область: иначе
    /// после подрезки размера низ или правый край уезжает под панель задач.
    fn clamp_position(&self, x: i32, y: i32, width: u32, height: u32) -> (i32, i32) {
        let right = self.x + (self.width as i32 - width as i32);
        let bottom = self.y + (self.height as i32 - height as i32);
        (x.clamp(self.x, right.max(self.x)), y.clamp(self.y, bottom.max(self.y)))
    }

    /// Центрирует окно в рабочей области.
    fn center(&self, width: u32, height: u32) -> (i32, i32) {
        (
            self.x + (self.width as i32 - width as i32) / 2,
            self.y + (self.height as i32 - height as i32) / 2,
        )
    }
}

/// Границы окна в физических пикселях (как `x`, `y`, `width`, `height` в конфиге).
#[derive(Debug, Clone, Copy)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Масштаб монитора, на котором окно должно оказаться.
    pub scale_factor: f64,
}

/// Границы из конфига как есть — если список мониторов недоступен.
fn stored_bounds(config: &AppConfig) -> WindowBounds {
    WindowBounds {
        x: config.x,
        y: config.y,
        width: config.width.max(MIN_WINDOW_WIDTH),
        height: config.height.max(MIN_WINDOW_HEIGHT),
        scale_factor: 1.0,
    }
}

/// Проверяет границы и возвращает корректные.
///
/// Окно не должно превышать рабочую область монитора, на котором окажется, и
/// должно целиком влезать в неё — иначе низ окна уезжает под панель задач.
/// Если окно видно меньше чем наполовину, оно центрируется на основном мониторе
/// (как `getValidBounds` в `electron/main.ts`).
pub fn valid_bounds(app: &AppHandle, config: &AppConfig) -> WindowBounds {
    let Ok(monitors) = app.available_monitors() else {
        return stored_bounds(config);
    };
    let Some(primary) = app.primary_monitor().ok().flatten() else {
        return stored_bounds(config);
    };

    let host = monitors
        .iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            config.x >= position.x
                && config.x < position.x + size.width as i32
                && config.y >= position.y
                && config.y < position.y + size.height as i32
        })
        .unwrap_or(&primary);

    let host_work_area = WorkArea::from(*host.work_area());
    let (width, height) = host_work_area.fit_size(config.width, config.height);
    let scale_factor = host.scale_factor();

    let window_area = (width as f64) * (height as f64);
    let visible = monitors.iter().any(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let intersection_x = config.x.max(position.x);
        let intersection_y = config.y.max(position.y);
        let intersection_width =
            (config.x + width as i32).min(position.x + size.width as i32) - intersection_x;
        let intersection_height =
            (config.y + height as i32).min(position.y + size.height as i32) - intersection_y;

        if intersection_width > 0 && intersection_height > 0 {
            (intersection_width as f64) * (intersection_height as f64) > window_area * 0.5
        } else {
            false
        }
    });

    if visible {
        let (x, y) = host_work_area.clamp_position(config.x, config.y, width, height);
        return WindowBounds { x, y, width, height, scale_factor };
    }

    let primary_work_area = WorkArea::from(*primary.work_area());
    let (width, height) = primary_work_area.fit_size(width, height);
    let (x, y) = primary_work_area.center(width, height);
    WindowBounds { x, y, width, height, scale_factor: primary.scale_factor() }
}

/// Тема документа передаётся в скрипт инициализации, а не через query-строку:
/// в production URL собран как `tauri://localhost/index.html` и query-параметры
/// к нему не приклеить, а `?view=port-forwarding` в React продолжает работать.
pub fn bootstrap_script(config: &AppConfig) -> String {
    match serde_json::to_string(config) {
        Ok(json) => format!("window.__YASSH_BOOTSTRAP__ = {json};"),
        Err(err) => {
            logger::error("Window", &format!("Failed to serialize bootstrap config: {err}"));
            "window.__YASSH_BOOTSTRAP__ = null;".to_owned()
        }
    }
}

/// Показывает окно, если готовы и страница, и рендерер, и размер.
///
/// Мьютекс `state.window` здесь намеренно **не удерживается** ни на чём
/// долгом: подгонка размера вынесена в [`prepare_startup_size`] и к моменту
/// показа уже завершена, поэтому между capture и `show()` остаётся только
/// `set_focus`.
///
/// [`startup_size_applied`](WindowState::startup_size_applied) — обязательное
/// условие, а не оптимизация: без него окно показалось бы с высотой на
/// 31–37 px больше нужной (см. [`apply_startup_size`]).
pub async fn show_if_ready(app: &AppHandle) -> bool {
    let state = app.state::<crate::state::AppState>();

    {
        let window_state = state.window.lock().await;
        let not_ready = !window_state.page_loaded
            || !window_state.renderer_content_ready
            || !window_state.startup_size_applied;
        if not_ready || window_state.shown {
            return window_state.shown;
        }
    }

    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return false;
    };

    // Показ объявляется до `show()`, чтобы параллельный вызов (например, из
    // fallback-таймера) не начал второй показ.
    {
        let mut window_state = state.window.lock().await;
        if window_state.shown {
            return true;
        }
        window_state.shown = true;
    }

    let _ = window.show();
    let _ = window.set_focus();
    logger::info("Window", "Main window shown");
    true
}

/// Доводит размер окна до сохранённого и снимает гейт [`show_if_ready`].
///
/// Обычный путь — [`PageLoadEvent::Started`](tauri::webview::PageLoadEvent::Started):
/// подгонка уходит в паузу на то время, пока webview разбирает HTML, CSS и JS, и
/// до первого видимого кадра уже готова. Раньше она выполнялась непосредственно
/// перед `show()` и добавляла к запуску 50–150 мс чистого ожидания.
///
/// Страховка вызывает функцию напрямую, когда страница не загрузилась вовсе и
/// `Started` не пришёл. Повторный вход (перезагрузка страницы из
/// `ErrorBoundary`) отсекается `STARTUP_SIZE_FIT_STARTED`, иначе подгонка
/// вернула бы окно к размеру первого запуска после того, как его переставил
/// пользователь.
pub async fn prepare_startup_size(app: &AppHandle) {
    if STARTUP_SIZE_FIT_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let window = app.get_webview_window(MAIN_WINDOW);
    if let Some(window) = window.as_ref() {
        apply_startup_size(window).await;
    }

    app.state::<crate::state::AppState>().window.lock().await.startup_size_applied = true;
    show_if_ready(app).await;
}

/// Подгонка размера выполняется один раз за процесс.
static STARTUP_SIZE_FIT_STARTED: AtomicBool = AtomicBool::new(false);

/// Сохраняет геометрию окна в конфиг (дебаунс 500 мс).
///
/// Свёрнутое и развёрнутое окно геометрию не сохраняют: у развёрнутого размер и
/// позиция относятся ко всему экрану, и следующий запуск открыл бы окно во весь
/// экран не на том месте.
pub async fn save_window_state(app: &AppHandle, immediate: bool) {
    if !immediate {
        // Дебаунс: перетаскивание окна шлёт события десятками раз в секунду.
        let app = app.clone();
        let state_app = app.clone();
        let persist_app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let state = state_app.state::<crate::state::AppState>();
            {
                let mut window_state = state.window.lock().await;
                if !window_state.save_pending {
                    return;
                }
                window_state.save_pending = false;
            }
            persist_window_state(&persist_app).await;
        });
        let state = app.state::<crate::state::AppState>();
        state.window.lock().await.save_pending = true;
        return;
    }

    persist_window_state(app).await;
}

async fn persist_window_state(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else { return };
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let is_maximized = window.is_maximized().unwrap_or(false);

    let mut config = crate::config::load();
    let mut changed = config.maximized != is_maximized;
    config.maximized = is_maximized;

    // Геометрия развёрнутого окна не сохраняется: иначе «восстановленный» размер
    // становился равен размеру экрана, а позиция — позицией развёрнутого окна.
    if !is_maximized {
        // Позиция — по внешней рамке (её же ставит `set_position`), размер — по
        // клиентской области (её же восстанавливает `set_size`): у frameless-окна
        // на Windows внешний размер (`outer_size`) на 16×9 px больше клиентской, и
        // при подмене одного другим окно каждый запуск раздувалось.
        let geometry = window
            .outer_position()
            .ok()
            .zip(window.inner_size().ok());
        if let Some((position, size)) = geometry {
            if config.x != position.x
                || config.y != position.y
                || config.width != size.width
                || config.height != size.height
            {
                config.x = position.x;
                config.y = position.y;
                config.width = size.width;
                config.height = size.height;
                changed = true;
            }
        }
    }

    if !changed {
        return;
    }

    if let Err(err) = crate::config::save_async(config).await {
        logger::warn("Window", &format!("Failed to save window state: {err}"));
    }
}


/// Событие `window-maximized-state`.
#[derive(Clone, Serialize)]
pub struct MaximizedState {
    pub is_maximized: bool,
}

/// Состояние закрытия окна, разбираемое в обработчике `CloseRequested`.
///
/// 0 — идёт обычная работа; 1 — первое нажатие, ждём сохранения геометрии и
/// держим окно открытым; 2 — сохранение закончено, следующее `CloseRequested`
/// должно закрыть окно.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseState {
    Idle,
    Saving,
    Saved,
}

impl CloseState {
    /// Восстанавливает состояние из байта, который лежит в атомарной ячейке.
    ///
    /// Неизвестное значение трактуется как `Idle`: лучше начать цикл закрытия
    /// заново, чем застрять в состоянии, которое ничего не разрешает.
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => CloseState::Saving,
            2 => CloseState::Saved,
            _ => CloseState::Idle,
        }
    }

    /// Решение по `CloseRequested` для текущего состояния.
    ///
    /// `true` означает `api.prevent_close()`: без него окно закроется раньше,
    /// чем сохранится геометрия.
    pub fn on_close_requested(self) -> (CloseState, bool) {
        match self {
            CloseState::Idle => (CloseState::Saving, true),
            // Повторное нажатие, пока пишется конфиг: окно всё ещё держим.
            CloseState::Saving => (CloseState::Saving, true),
            // Сохранение закончено — закрываем. Состояние возвращается в Idle,
            // чтобы следующий цикл (окно могло быть переоткрыто) начался заново.
            CloseState::Saved => (CloseState::Idle, false),
        }
    }
}

impl From<CloseState> for u8 {
    fn from(value: CloseState) -> Self {
        match value {
            CloseState::Idle => 0,
            CloseState::Saving => 1,
            CloseState::Saved => 2,
        }
    }
}

/// Предел ожидания сохранения геометрии при закрытии окна.
///
/// Запись конфига идёт через общую очередь и диск, поэтому в редких случаях
/// она задерживается. Закрытие окна не должно от неё зависеть.
const WINDOW_STATE_SAVE_TIMEOUT: Duration = Duration::from_secs(2);

/// Подписывается на события окна (размер, перемещение, фокус, закрытие, drag&drop).
pub fn attach_listeners(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else { return };

    let app = app.clone();
    // Состояние закрытия: `Idle` — обычная работа, `Saving` — ждём записи
    // геометрии и держим окно, `Saved` — можно закрывать.
    let close_state = Arc::new(AtomicU8::new(CloseState::Idle.into()));
    window.on_window_event(move |event| {
        let app = app.clone();
        match event {
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                tauri::async_runtime::spawn(async move {
                    save_window_state(&app, false).await;
                });
            }
            WindowEvent::CloseRequested { api, .. } => {
                // Решение принимает чистая функция `on_close_requested` —
                // её поведение проверяется тестом без реального окна.
                let current = close_state.load(Ordering::Acquire);
                let (next, block) =
                    CloseState::from_u8(current).on_close_requested();
                close_state.store(next.into(), Ordering::Release);

                if !block {
                    return;
                }
                api.prevent_close();

                // Сохранение геометрии ограничено по времени намеренно.
                // Состояние переходит в «разрешаем закрытие» только после
                // него, поэтому зависшее сохранение навсегда оставило бы окно
                // в состоянии `Saving`, где каждая следующая попытка закрытия
                // вызывает `prevent_close()`: приложение выглядит зависшим и не
                // закрывается вовсе. Ценность сохранённых двух координат не
                // стоит невозможности закрыть окно.
                let close_state = close_state.clone();
                let window = app.get_webview_window(MAIN_WINDOW);
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::time::timeout(
                        WINDOW_STATE_SAVE_TIMEOUT,
                        save_window_state(&app, true),
                    )
                    .await;
                    close_state.store(CloseState::Saved.into(), Ordering::Release);
                    if let Some(window) = window {
                        let _ = window.close();
                    }
                });
            }
            WindowEvent::DragDrop(tauri::DragDropEvent::Enter { .. }) => {
                let _ = app.emit("yash-drag-drop-state", true);
            }
            WindowEvent::DragDrop(tauri::DragDropEvent::Leave) => {
                let _ = app.emit("yash-drag-drop-state", false);
            }
            WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                let _ = app.emit("yash-drag-drop-state", false);
                if !paths.is_empty() {
                    let _ = app.emit("yash-drag-drop-paths", paths);
                }
            }
            _ => {}
        }
    });
}

/// Сообщает UI о развёртывании/разворачивании окна.
pub async fn emit_maximized_state(app: &AppHandle, is_maximized: bool) {
    let _ = app.emit("window-maximized-state", MaximizedState { is_maximized });
}

/// Создаёт главное окно приложения.
pub fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let config = crate::config::load();
    let bounds = valid_bounds(app, &config);
    let background = theme_color(&config.theme);
    let url = frontend_url(app);
    let page_app = app.clone();
    // Границы читает подгонка размера, запускаемая из `on_page_load` на
    // `PageLoadEvent::Started`. Ставим их до `build()`, чтобы событие не могло
    // прийти раньше, чем они появятся: иначе подгонка молча вышла бы по
    // `STARTUP_BOUNDS.get() == None` и окно показалось бы с неверной высотой.
    let _ = STARTUP_BOUNDS.set(bounds);

    let builder = tauri::WebviewWindowBuilder::new(app, MAIN_WINDOW, url)
        .title("YetAnotherSSHClient")
        // Builder APIs take logical pixels; config and monitor APIs here use
        // physical pixels, so the validated bounds are converted through the
        // scale factor of the monitor the window will land on. The size has to
        // be given to the builder: a `set_size` right after `build()` measures
        // the still-undecorated window frame on Windows and overshoots the
        // height by the caption height, which made the window grow on every
        // launch.
        .inner_size(
            f64::from(bounds.width) / bounds.scale_factor,
            f64::from(bounds.height) / bounds.scale_factor,
        )
        .position(
            f64::from(bounds.x) / bounds.scale_factor,
            f64::from(bounds.y) / bounds.scale_factor,
        )
        .min_inner_size(f64::from(MIN_WINDOW_WIDTH), f64::from(MIN_WINDOW_HEIGHT))
        .visible(false)
        .background_color(tauri::window::Color(background.0, background.1, background.2, background.3))
        // Синхронный снимок конфига: `getConfigSync()` обязан работать до
        // первого `await`, иначе интерфейс не стартует (см. `useConfig`).
        .initialization_script(bootstrap_script(&config))
        // Навигация внутри webview запрещена: единственная допустимая цель —
        // собственный интерфейс приложения.
        .on_navigation(|url| matches!(url.scheme(), "tauri" | "http" | "https" | "devtools"))
        .on_page_load(move |_window, payload| {
            let app = page_app.clone();
            match payload.event() {
                // Подгонка размера — в начале загрузки страницы: webview уже
                // создан, поэтому замер рамки корректен, а пауза приходится на
                // разбор HTML, CSS и JS, а не на путь к первому видимому кадру.
                tauri::webview::PageLoadEvent::Started => {
                    tauri::async_runtime::spawn(async move {
                        prepare_startup_size(&app).await;
                    });
                }
                tauri::webview::PageLoadEvent::Finished => {
                    tauri::async_runtime::spawn(async move {
                        app.state::<crate::state::AppState>().window.lock().await.page_loaded = true;
                        show_if_ready(&app).await;
                    });
                }
            }
        })
        .devtools(cfg!(debug_assertions));

    // macOS: системная рамка нужна ради нативных traffic lights слева. Заголовок
    // скрыт, фон прозрачный, контент заходит под него (`Overlay`), поэтому сверху
    // по-прежнему видна собственная шапка приложения.
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay);
    // Windows и Linux: полностью frameless-окно, рамку и заголовок рисует интерфейс.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    let window = builder.build()?;
    window.set_position(PhysicalPosition::new(bounds.x, bounds.y))?;
    if config.maximized {
        window.maximize()?;
    }
    Ok(())
}

/// Границы, заданные при создании окна: их подтверждает [`apply_startup_size`]
/// до снятия гейта показа.
static STARTUP_BOUNDS: OnceLock<WindowBounds> = OnceLock::new();

/// Доводит размер окна до сохранённого.
///
/// `set_size` сразу после `build()` на Windows попадает в ещё не декорированное
/// окно: tao измеряет рамку, в которую входит заголовок, и высота получается на
/// 37 px больше запрошенной при масштабе 125 % (на 31 px при 100 %). Повторный
/// вызов после создания webview меряет уже готовую рамку и попадает точно в
/// цель. Пока идёт подгонка, окно скрыто, поэтому размер никто не видит, а
/// вызывается она по [`PageLoadEvent::Started`](tauri::webview::PageLoadEvent::Started)
/// — webview к этому моменту уже создан, и пауза приходится на разбор страницы.
async fn apply_startup_size(window: &tauri::WebviewWindow) {
    let Some(bounds) = STARTUP_BOUNDS.get() else { return };
    let target = PhysicalSize::new(bounds.width, bounds.height);

    // Размер обычно уже задан билдером, и проверка проходит без `set_size` и
    // без паузы — тогда подгонка не стоит ничего. Повторный `set_size` нужен
    // лишь когда тао успел измерить ещё не готовую рамку.
    match window.inner_size() {
        Ok(size) if size == target => return,
        Ok(_) => {}
        Err(err) => {
            logger::warn("Window", &format!("Failed to read window size: {err}"));
            return;
        }
    }

    for attempt in 1..=3u32 {
        if let Err(err) = window.set_size(target) {
            logger::warn("Window", &format!("Failed to apply window size: {err}"));
            return;
        }
        // `set_size` уходит в поток event loop, поэтому результат виден только
        // после паузы.
        tokio::time::sleep(Duration::from_millis(50)).await;
        match window.inner_size() {
            Ok(size) if size == target => return,
            Ok(size) => logger::warn(
                "Window",
                &format!("Window size not applied on attempt {attempt}: {size:?} instead of {target:?}"),
            ),
            Err(err) => {
                logger::warn("Window", &format!("Failed to read window size: {err}"));
                return;
            }
        }
    }
}

/// URL интерфейса: dev-сервер в разработке, собранные ресурсы в production.
fn frontend_url(app: &AppHandle) -> tauri::WebviewUrl {
    use tauri::WebviewUrl;

    if cfg!(debug_assertions) {
        let dev_url = app.config().build.dev_url.clone();
        if let Some(url) = dev_url {
            return WebviewUrl::External(url);
        }
    }
    WebviewUrl::App("index.html".into())
}

/// Цвет окна до первого рендера — по теме (порт `getThemeColor`).
pub fn theme_color(theme: &str) -> (u8, u8, u8, u8) {
    match theme {
        "Light" => (0xF7, 0xF8, 0xFA, 0xFF),
        "Dark" => (0x1A, 0x1D, 0x21, 0xFF),
        // Auto: цвет системной темы узнать до рендера нельзя, берём тёмный —
        // это менее заметный «переход» при старте, чем белый.
        _ => (0x1A, 0x1D, 0x21, 0xFF),
    }
}

/// Размер окна по умолчанию для первого запуска.
pub fn default_size() -> LogicalSize<f64> {
    LogicalSize::new(1277.0, 911.0)
}

#[cfg(test)]
#[path = "tests/window.rs"]
mod tests;
