//! Окно приложения — порт `createWindow` и `saveWindowState` из
//! `electron/main.ts`.
//!
//! Окно frameless (`decorations: false`), минимальный размер 800×500, показ
//! только после готовности рендерера, сохранение геометрии с дебаунсом 500 мс и
//! квантованием до 4 DIP.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, Window, WindowEvent};
use tokio::sync::Mutex;

use crate::config::AppConfig;
use crate::logger;

/// Минимальный размер окна.
pub const MIN_WINDOW_WIDTH: u32 = 800;
pub const MIN_WINDOW_HEIGHT: u32 = 500;

/// Шаг, кратному которому приводятся сохраняемые размеры окна.
///
/// При масштабе 125% в целые физические пиксели переводятся только размеры,
/// кратные 4: 958 × 1.25 = 1197.5 не представимо целым числом, поэтому `setBounds`
/// возвращает 959, и на каждом перезапуске высота окна росла на 1 px. Кратное 4
/// переводится точно при 100%, 125%, 150% и 175%.
pub const WINDOW_SIZE_QUANTUM: u32 = 4;

/// Метка главного окна.
pub const MAIN_WINDOW: &str = "main";

/// Состояние окна между вызовами обработчиков.
pub struct WindowState {
    /// Рендерер сообщил о готовности контента.
    pub renderer_content_ready: bool,
    /// Страница загрузилась.
    pub page_loaded: bool,
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
            shown: false,
            save_pending: false,
        }
    }
}

/// Приводит размер к кратному [`WINDOW_SIZE_QUANTUM`].
pub fn snap_window_size(size: u32) -> u32 {
    (size / WINDOW_SIZE_QUANTUM) * WINDOW_SIZE_QUANTUM
}

/// Границы окна в логических пикселях.
#[derive(Debug, Clone, Copy)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Проверяет границы и возвращает корректные.
///
/// Окно не должно превышать рабочую область монитора, на котором окажется, и
/// должно быть видимо хотя бы наполовину — иначе центрируется на основном
/// мониторе (как `getValidBounds` в `electron/main.ts`).
pub fn valid_bounds(app: &AppHandle, config: &AppConfig) -> WindowBounds {
    let mut width = config.width.max(MIN_WINDOW_WIDTH);
    let mut height = config.height.max(MIN_WINDOW_HEIGHT);

    let Ok(monitors) = app.available_monitors() else {
        return WindowBounds { x: config.x, y: config.y, width, height };
    };
    let Some(primary) = app.primary_monitor().ok().flatten() else {
        return WindowBounds { x: config.x, y: config.y, width, height };
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

    let host_work_area = *host.work_area();
    width = snap_window_size(width.min(host_work_area.width as u32)).max(MIN_WINDOW_WIDTH);
    height = snap_window_size(height.min(host_work_area.height as u32)).max(MIN_WINDOW_HEIGHT);

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
        return WindowBounds { x: config.x, y: config.y, width, height };
    }

    let work_area = *primary.work_area();
    let work_position = primary.position();
    WindowBounds {
        x: work_position.x + ((work_area.width as i32) - width as i32) / 2,
        y: work_position.y + ((work_area.height as i32) - height as i32) / 2,
        width,
        height,
    }
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

/// Показывает окно, если готовы и страница, и рендерер.
pub async fn show_if_ready(app: &AppHandle) -> bool {
    let state = app.state::<crate::state::AppState>();
    let mut window_state = state.window.lock().await;

    if !window_state.page_loaded || !window_state.renderer_content_ready || window_state.shown {
        return window_state.shown;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    window_state.shown = true;
    logger::info("Window", "Main window shown");
    true
}

/// Сохраняет геометрию окна в конфиг (дебаунс 500 мс).
///
/// Свёрнутое окно не сохраняется: при разворачивании и обратном сворачивании
/// `getBounds` вернул бы размеры развёрнутого окна, и следующий запуск открыл бы
/// его во весь экран.
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
    // Развёрнутое окно не сохраняет свои bounds: иначе после разворачивания
    // «восстановленный» размер становился равен размеру экрана.
    let bounds = if is_maximized {
        window.inner_size().ok()
    } else {
        window.outer_size().ok()
    };
    let position = window.outer_position().unwrap_or(PhysicalPosition { x: 0, y: 0 });

    let mut config = crate::config::load();
    let width = bounds.map(|size| snap_window_size(size.width)).unwrap_or(config.width);
    let height = bounds.map(|size| snap_window_size(size.height)).unwrap_or(config.height);
    let x = position.x;
    let y = position.y;

    if config.x == x
        && config.y == y
        && config.width == width
        && config.height == height
        && config.maximized == is_maximized
    {
        return;
    }

    config.x = x;
    config.y = y;
    config.width = width;
    config.height = height;
    config.maximized = is_maximized;

    if let Err(err) = crate::config::save_async(config).await {
        logger::warn("Window", &format!("Failed to save window state: {err}"));
    }
}

/// Событие `window-maximized-state`.
#[derive(Clone, Serialize)]
pub struct MaximizedState {
    pub is_maximized: bool,
}

/// Подписывается на события окна (размер, перемещение, фокус, закрытие, drag&drop).
pub fn attach_listeners(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else { return };

    let app = app.clone();
    window.on_window_event(move |event| {
        let app = app.clone();
        match event {
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                tauri::async_runtime::spawn(async move {
                    save_window_state(&app, false).await;
                });
            }
            WindowEvent::CloseRequested { .. } => {
                tauri::async_runtime::spawn(async move {
                    save_window_state(&app, true).await;
                });
            }
            WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                // Tauri отдаёт пути сразу: renderer сопоставляет их с объектами
                // DataTransfer в `getPathForFile` (см. мост `src/ipc/tauri-bridge.ts`).
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
    use tauri::WebviewUrl;

    let config = crate::config::load();
    let bounds = valid_bounds(app, &config);
    let background = theme_color(&config.theme);
    let url = frontend_url(app);
    let page_app = app.clone();

    let mut builder = tauri::WebviewWindowBuilder::new(app, MAIN_WINDOW, url)
        .title("YetAnotherSSHClient")
        .inner_size(f64::from(bounds.width), f64::from(bounds.height))
        .position(bounds.x as f64, bounds.y as f64)
        .min_inner_size(f64::from(MIN_WINDOW_WIDTH), f64::from(MIN_WINDOW_HEIGHT))
        // Frameless-окно: рамку и заголовок рисует интерфейс приложения.
        .decorations(false)
        .visible(false)
        .background_color(tauri::window::Color(background.0, background.1, background.2, background.3))
        // Синхронный снимок конфига: `getConfigSync()` обязан работать до
        // первого `await`, иначе интерфейс не стартует (см. `useConfig`).
        .initialization_script(bootstrap_script(&config))
        // Навигация внутри webview запрещена: единственная допустимая цель —
        // собственный интерфейс приложения.
        .on_navigation(|url| matches!(url.scheme(), "tauri" | "http" | "https" | "devtools"))
        .on_page_load(move |_window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let app = page_app.clone();
                tauri::async_runtime::spawn(async move {
                    app.state::<crate::state::AppState>().window.lock().await.page_loaded = true;
                    show_if_ready(&app).await;
                });
            }
        })
        .devtools(cfg!(debug_assertions));

    if config.maximized {
        builder = builder.maximized(true);
    }

    builder.build()?;
    Ok(())
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
mod tests {
    use super::*;

    #[test]
    fn квантует_размеры() {
        assert_eq!(snap_window_size(958), 956);
        assert_eq!(snap_window_size(1277), 1276);
        assert_eq!(snap_window_size(1276), 1276);
        assert_eq!(snap_window_size(10), 8);
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
}
