//! Нативные Windows Snap Layouts и ввод кнопок заголовка.
//!
//! Подход взят из `tauri-plugin-frame` (форк `tauri-plugin-decorum`).
//! Важно, чем именно: плагин decorum открывает меню привязки отправкой
//! глобальных нажатий `Win+Z` и `Alt` через крейт `enigo`. Это синтетический
//! ввод в масштабе системы, а не нативный механизм.
//!
//! `tauri-plugin-frame` так не делает: он создаёт **дочернее прозрачное окно**
//! над кнопками сворачивания, развёртывания и закрытия. Он отвечает на
//! `WM_NCHITTEST` системными hit-test кодами и посылает команды окну напрямую,
//! без участия рендерера. Меню привязки открывает Windows.
//!
//! Почему не подключаем плагин, а переносим подход:
//! * модуль `snap` в плагине приватный, снаружи только `create_overlay_titlebar`;
//! * он же внедряет в страницу собственные кнопки через `window.__TAURI__`,
//!   то есть требует `withGlobalTauri: true` — у нас там собственный IPC-мост;
//! * кнопки в проекте уже нарисованы в React, с подписями на RU и EN.
//!
//! Подкласс главного окна обрабатывает только `WM_SIZE`, `WM_DPICHANGED` и
//! `WM_NCDESTROY`: перемещает оверлей и освобождает его при уничтожении окна.
//! Остальные сообщения идут исходной процедуре окна.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewWindow};

use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetStockObject, ScreenToClient, HBRUSH, NULL_BRUSH};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT,
};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, GetParent, IsZoomed,
    PostMessageW, RegisterClassExW, SetWindowPos, CS_HREDRAW, CS_VREDRAW, HTCLOSE, HTMAXBUTTON,
    HTMINBUTTON, HWND_TOP, SC_MAXIMIZE, SC_MINIMIZE, SC_RESTORE, SWP_ASYNCWINDOWPOS,
    SWP_SHOWWINDOW, WM_CLOSE, WM_DPICHANGED, WM_NCDESTROY, WM_NCHITTEST, WM_NCLBUTTONDOWN,
    WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_SIZE, WM_SYSCOMMAND, WNDCLASSEXW, WS_CHILD,
    WS_CLIPSIBLINGS, WS_OVERLAPPED, WS_VISIBLE,
};

/// Имя класса оверлея. Многобайтное объявление — `windows-sys` ждёт `*const u16`.
const OVERLAY_CLASS: &[u16] = &[
    b'Y' as u16,
    b'A' as u16,
    b'S' as u16,
    b'S' as u16,
    b'H' as u16,
    b'C' as u16,
    b'a' as u16,
    b'p' as u16,
    0,
];

/// Идентификатор подкласса. Произвольное число, уникальное в пределах окна.
const SUBCLASS_ID: usize = 0x5941_5353;

/// Событие «курсор над кнопкой развёртывания».
pub const EVENT_CAPTION_HOVER: &str = "window-caption-hover";
/// Событие «курсор над кнопкой закрытия».
pub const EVENT_CLOSE_HOVER: &str = "window-close-hover";
/// Событие «курсор над кнопкой сворачивания».
pub const EVENT_MINIMIZE_HOVER: &str = "window-minimize-hover";

/// Оверлей над нативными кнопками окна для одного окна.
struct Overlay {
    hwnd: HWND,
    app: AppHandle,
    titlebar_height: u32,
    button_width: u32,
    /// Сколько кнопок расположено правее сворачивания: развёртывание и закрытие.
    buttons_to_right: u32,
    minimize_hovering: bool,
    minimize_pressed: bool,
    hovering: bool,
    pressed: bool,
    close_hovering: bool,
    close_pressed: bool,
}

// `HWND` — голый указатель, поэтому `Send` не выводится автоматически.
// Значение используется только из потока окна, куда установку переносит
// `run_on_main_thread`.
unsafe impl Send for Overlay {}

/// Оверлеи всех окон, у которых включены Snap Layouts.
static OVERLAYS: Mutex<Option<HashMap<isize, Overlay>>> = Mutex::new(None);

/// Помещает прозрачный оверлей над кнопкой развёртывания.
///
/// Ошибку не поднимает и ничего не ломает: без оверлея приложение работает
/// как раньше, просто без меню привязки Windows 11.
pub fn install_snap_overlay(
    app: &AppHandle,
    window: &WebviewWindow,
    titlebar_height: u32,
    button_width: u32,
    buttons_to_right: u32,
) {
    let Ok(handle) = window.hwnd() else {
        crate::logger::warn("Window", "Snap overlay: window has no HWND");
        return;
    };
    let parent = handle.0;
    if parent.is_null() {
        return;
    }

    // `run_on_main_thread` требует `Send` у замыкания, а `HWND` — голый
    // указатель. Поэтому в замыкание уходит целое число, а указатель
    // восстанавливается уже в потоке окна.
    let parent_key = parent as isize;
    let app = app.clone();
    let label = window.label().to_owned();
    // Создавать окно и вешать подкласс можно только из потока окна.
    if window
        .run_on_main_thread(move || unsafe {
            install_hwnd(
                parent_key as HWND,
                app,
                label,
                titlebar_height,
                button_width,
                buttons_to_right,
            );
        })
        .is_err()
    {
        crate::logger::warn("Window", "Snap overlay: cannot schedule install");
    }
}

/// Вычисление масштаба от эталонных 96 dpi, как в Windows.
fn scaled(value: u32, dpi: u32) -> i32 {
    ((u64::from(value) * u64::from(dpi) + 48) / 96) as i32
}

unsafe fn module_instance() -> HINSTANCE {
    GetModuleHandleW(std::ptr::null())
}

/// Регистрирует класс оверлея. Повторные вызовы безвредны.
unsafe fn register_class() {
    let class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(overlay_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: module_instance(),
        hIcon: std::ptr::null_mut(),
        hCursor: std::ptr::null_mut(),
        // NULL_BRUSH: оверлей не рисует фон и не закрашивает кнопку под собой.
        hbrBackground: GetStockObject(NULL_BRUSH) as HBRUSH,
        lpszMenuName: std::ptr::null(),
        lpszClassName: OVERLAY_CLASS.as_ptr(),
        hIconSm: std::ptr::null_mut(),
    };
    RegisterClassExW(&class);
}

/// Состояние оверлея окна. **Блокировка берётся ровно один раз на вызов**:
/// повторный `OVERLAYS.lock()` внутри, покаMutex уже удерживается, вешает
/// поток окна — раньше так и происходило на первом же наведении мыши.
fn with_overlay<R>(parent: HWND, f: impl FnOnce(&mut Overlay) -> R) -> Option<R> {
    let mut states = OVERLAYS.lock().ok()?;
    let state = states.as_mut()?.get_mut(&(parent as isize))?;
    Some(f(state))
}

/// Отправляет событие окну с оверлеем. Блокировка снимается до отправки.
fn emit_to<P: Serialize + Clone>(parent: HWND, event: &str, payload: P) {
    if parent.is_null() {
        return;
    }
    let app = OVERLAYS.lock().ok().and_then(|states| {
        states
            .as_ref()
            .and_then(|m| m.get(&(parent as isize)).map(|s| s.app.clone()))
    });
    if let Some(app) = app {
        let _ = app.emit(event, payload);
    }
}

unsafe fn install_hwnd(
    parent: HWND,
    app: AppHandle,
    label: String,
    titlebar_height: u32,
    button_width: u32,
    buttons_to_right: u32,
) {
    register_class();

    let overlay = CreateWindowExW(
        0,
        OVERLAY_CLASS.as_ptr(),
        OVERLAY_CLASS.as_ptr(),
        WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_OVERLAPPED,
        0,
        0,
        0,
        0,
        parent,
        std::ptr::null_mut(),
        module_instance(),
        std::ptr::null_mut(),
    );
    if overlay.is_null() {
        crate::logger::warn("Window", "Snap overlay: CreateWindowExW failed");
        return;
    }

    // Прежний оверлей снимаем до блокировки: `DestroyWindow` отправляет
    // сообщения старому окну, и его процедура тоже берёт этот же Mutex.
    let previous = {
        let mut states = OVERLAYS.lock().expect("OVERLAYS poisoned");
        states.as_mut().and_then(|m| m.remove(&(parent as isize)))
    };
    if let Some(old) = previous {
        RemoveWindowSubclass(parent, Some(parent_subclass_proc), SUBCLASS_ID);
        DestroyWindow(old.hwnd);
    }

    {
        let mut states = OVERLAYS.lock().expect("OVERLAYS poisoned");
        states.get_or_insert_with(HashMap::new).insert(
            parent as isize,
            Overlay {
                hwnd: overlay,
                app,
                titlebar_height,
                button_width,
                buttons_to_right,
                minimize_hovering: false,
                minimize_pressed: false,
                hovering: false,
                pressed: false,
                close_hovering: false,
                close_pressed: false,
            },
        );
    }

    SetWindowSubclass(parent, Some(parent_subclass_proc), SUBCLASS_ID, 0);
    reposition(parent);
    crate::logger::info("Window", &format!("Snap overlay installed ({label})"));
}

/// Ставит оверлей по левому верхнему углу кнопки сворачивания.
unsafe fn reposition(parent: HWND) {
    let Ok(states) = OVERLAYS.lock() else { return };
    let Some(state) = states.as_ref().and_then(|s| s.get(&(parent as isize))) else {
        return;
    };

    let mut rect = std::mem::zeroed();
    if GetClientRect(parent, &mut rect) == 0 {
        return;
    }

    let dpi = GetDpiForWindow(parent);
    let button_width = scaled(state.button_width, dpi).max(1);
    let width = button_width * 3;
    let height = scaled(state.titlebar_height, dpi).max(1);
    let x = rect.right - button_width * (state.buttons_to_right as i32 + 1);

    SetWindowPos(
        state.hwnd,
        HWND_TOP,
        x,
        0,
        width,
        height,
        SWP_ASYNCWINDOWPOS | SWP_SHOWWINDOW,
    );
}

/// Координаты мыши в `WM_NCHITTEST` и `WM_NCMOUSEMOVE` заданы на экране.
unsafe fn message_position_in_client(hwnd: HWND, lparam: LPARAM) -> Option<POINT> {
    let mut point = POINT {
        x: (lparam as u16 as i16).into(),
        y: ((lparam >> 16) as u16 as i16).into(),
    };
    (ScreenToClient(hwnd, &mut point) != 0).then_some(point)
}

/// Подкласс родительского окна: только перестановка и уборка оверлея.
unsafe extern "system" fn parent_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    match msg {
        WM_SIZE | WM_DPICHANGED => reposition(hwnd),
        WM_NCDESTROY => uninstall(hwnd),
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CaptionButton {
    Minimize,
    Maximize,
    Close,
}

fn caption_button_at(x: i32, button_width: i32) -> CaptionButton {
    if x < button_width {
        CaptionButton::Minimize
    } else if x < button_width * 2 {
        CaptionButton::Maximize
    } else {
        CaptionButton::Close
    }
}

fn caption_button_hit_test(button: CaptionButton) -> LRESULT {
    match button {
        CaptionButton::Minimize => HTMINBUTTON as LRESULT,
        CaptionButton::Maximize => HTMAXBUTTON as LRESULT,
        CaptionButton::Close => HTCLOSE as LRESULT,
    }
}

/// Процедура оверлея: системный hit test, hover и нативные команды окна.
unsafe extern "system" fn overlay_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        // Отмечаем области как системные caption-кнопки. Snap Layouts
        // показывает Windows; команды кнопок выполняются ниже без IPC в UI.
        WM_NCHITTEST => {
            let Some(cursor) = message_position_in_client(hwnd, lparam) else {
                return HTMAXBUTTON as LRESULT;
            };
            let parent = GetParent(hwnd);
            let button_width = with_overlay(parent, |state| {
                scaled(state.button_width, GetDpiForWindow(parent)).max(1)
            })
            .unwrap_or(1);
            return caption_button_hit_test(caption_button_at(cursor.x, button_width));
        }
        WM_NCMOUSEMOVE => {
            let parent = GetParent(hwnd);
            let hovered_button = message_position_in_client(hwnd, lparam)
                .map(|cursor| {
                    let button_width = with_overlay(parent, |state| {
                        scaled(state.button_width, GetDpiForWindow(parent)).max(1)
                    })
                    .unwrap_or(i32::MAX);
                    caption_button_at(cursor.x, button_width)
                })
                .unwrap_or(CaptionButton::Maximize);
            let changes = with_overlay(parent, |state| {
                let minimize_changed =
                    state.minimize_hovering != (hovered_button == CaptionButton::Minimize);
                let maximize_changed =
                    state.hovering != (hovered_button == CaptionButton::Maximize);
                let close_changed =
                    state.close_hovering != (hovered_button == CaptionButton::Close);
                state.minimize_hovering = hovered_button == CaptionButton::Minimize;
                state.hovering = hovered_button == CaptionButton::Maximize;
                state.close_hovering = hovered_button == CaptionButton::Close;
                (minimize_changed, maximize_changed, close_changed)
            })
            .unwrap_or((false, false, false));
            if changes.0 {
                emit_to(
                    parent,
                    EVENT_MINIMIZE_HOVER,
                    hovered_button == CaptionButton::Minimize,
                );
            }
            if changes.1 {
                emit_to(
                    parent,
                    EVENT_CAPTION_HOVER,
                    hovered_button == CaptionButton::Maximize,
                );
            }
            if changes.2 {
                emit_to(
                    parent,
                    EVENT_CLOSE_HOVER,
                    hovered_button == CaptionButton::Close,
                );
            }

            let mut track = TRACKMOUSEEVENT {
                cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_LEAVE | TME_NONCLIENT,
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            TrackMouseEvent(&mut track);
            return 0;
        }
        WM_NCMOUSELEAVE => {
            let parent = GetParent(hwnd);
            with_overlay(parent, |state| {
                state.minimize_hovering = false;
                state.minimize_pressed = false;
                state.hovering = false;
                state.pressed = false;
                state.close_hovering = false;
                state.close_pressed = false;
            });
            emit_to(parent, EVENT_MINIMIZE_HOVER, false);
            emit_to(parent, EVENT_CAPTION_HOVER, false);
            emit_to(parent, EVENT_CLOSE_HOVER, false);
            return 0;
        }
        WM_NCLBUTTONDOWN => {
            let parent = GetParent(hwnd);
            with_overlay(parent, |state| match wparam as isize {
                value if value == HTMINBUTTON as isize => state.minimize_pressed = true,
                value if value == HTMAXBUTTON as isize => state.pressed = true,
                value if value == HTCLOSE as isize => state.close_pressed = true,
                _ => {}
            });
            return 0;
        }
        WM_NCLBUTTONUP => {
            let parent = GetParent(hwnd);
            let (minimize_clicked, maximize_clicked, close_clicked) =
                with_overlay(parent, |state| {
                    let minimize_clicked =
                        state.minimize_pressed && wparam as isize == HTMINBUTTON as isize;
                    let maximize_clicked = state.pressed && wparam as isize == HTMAXBUTTON as isize;
                    let close_clicked = state.close_pressed && wparam as isize == HTCLOSE as isize;
                    state.minimize_pressed = false;
                    state.pressed = false;
                    state.close_pressed = false;
                    (minimize_clicked, maximize_clicked, close_clicked)
                })
                .unwrap_or((false, false, false));
            if minimize_clicked {
                PostMessageW(parent, WM_SYSCOMMAND, SC_MINIMIZE as WPARAM, 0);
            } else if maximize_clicked {
                let command = if IsZoomed(parent) != 0 {
                    SC_RESTORE
                } else {
                    SC_MAXIMIZE
                };
                PostMessageW(parent, WM_SYSCOMMAND, command as WPARAM, 0);
            } else if close_clicked {
                // Проходит через обычный CloseRequested Tauri-цикл (сохранение
                // геометрии и таймаут), не через UI.
                PostMessageW(parent, WM_CLOSE, 0, 0);
            }
            return 0;
        }
        _ => {}
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

/// Снимает оверлей с окна.
unsafe fn uninstall(parent: HWND) {
    RemoveWindowSubclass(parent, Some(parent_subclass_proc), SUBCLASS_ID);
    let removed = OVERLAYS
        .lock()
        .ok()
        .and_then(|mut states| states.as_mut().and_then(|m| m.remove(&(parent as isize))));
    if let Some(old) = removed {
        DestroyWindow(old.hwnd);
    }
}
