//! Нативные Windows Snap Layouts поверх кнопки развёртывания.
//!
//! Подход взят из `tauri-plugin-frame` (форк `tauri-plugin-decorum`).
//! Важно, чем именно: плагин decorum открывает меню привязки отправкой
//! глобальных нажатий `Win+Z` и `Alt` через крейт `enigo`. Это синтетический
//! ввод в масштабе системы, а не нативный механизм.
//!
//! `tauri-plugin-frame` так не делает: он создаёт **дочернее прозрачное окно**
//! ровно над кнопкой развёртывания и отвечает на `WM_NCHITTEST` значением
//! `HTMAXBUTTON`. Меню привязки после этого рисует сама Windows.
//!
//! Почему не подключаем плагин, а переносим подход:
//! * модуль `snap` в плагине приватный, снаружи только `create_overlay_titlebar`;
//! * он же внедряет в страницу собственные кнопки через `window.__TAURI__`,
//!   то есть требует `withGlobalTauri: true` — у нас там собственный IPC-мост;
//! * кнопки в проекте уже нарисованы в React, с подписями на RU и EN.
//!
//! Перехвата процедуры главного окна здесь нет: она у плагина заменяется
//! через `SetWindowSubclass` только для `WM_SIZE`, `WM_DPICHANGED` и
//! `WM_CLOSE`, чтобы двигать и убирать оверлей. Drag, resize и закрытие окна
//! идут через исходную процедуру без изменений.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewWindow};

use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetStockObject, HBRUSH, NULL_BRUSH};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT,
};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, GetParent, RegisterClassExW,
    SetWindowPos, CS_HREDRAW, CS_VREDRAW, HTMAXBUTTON, HWND_TOP, SWP_ASYNCWINDOWPOS,
    SWP_SHOWWINDOW, WM_CLOSE, WM_DPICHANGED, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP,
    WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_SIZE, WNDCLASSEXW, WS_CHILD, WS_CLIPSIBLINGS,
    WS_OVERLAPPED, WS_VISIBLE,
};

/// Имя класса оверлея. Многобайтное объявление — `windows-sys` ждёт `*const u16`.
const OVERLAY_CLASS: &[u16] = &[
    b'Y' as u16, b'A' as u16, b'S' as u16, b'S' as u16, b'H' as u16, b'C' as u16, b'a' as u16,
    b'p' as u16, 0,
];

/// Идентификатор подкласса. Произвольное число, уникальное в пределах окна.
const SUBCLASS_ID: usize = 0x5941_5353;

/// Событие «курсор над кнопкой развёртывания».
pub const EVENT_CAPTION_HOVER: &str = "window-caption-hover";
/// Событие «нажата кнопка развёртывания».
pub const EVENT_CAPTION_CLICK: &str = "window-caption-click";

/// Оверлей над кнопкой развёртывания для одного окна.
struct Overlay {
    hwnd: HWND,
    app: AppHandle,
    titlebar_height: u32,
    button_width: u32,
    /// Сколько кнопок окна стоят правее развёртывания: только закрытие.
    buttons_to_right: u32,
    hovering: bool,
    pressed: bool,
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
    let app = OVERLAYS
        .lock()
        .ok()
        .and_then(|states| {
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
        states
            .as_mut()
            .and_then(|m| m.remove(&(parent as isize)))
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
                hovering: false,
                pressed: false,
            },
        );
    }

    SetWindowSubclass(parent, Some(parent_subclass_proc), SUBCLASS_ID, 0);
    reposition(parent);
    crate::logger::info("Window", &format!("Snap overlay installed ({label})"));
}

/// Ставит оверлей по левому верхнему углу кнопки развёртывания.
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
    let width = scaled(state.button_width, dpi).max(1);
    let height = scaled(state.titlebar_height, dpi).max(1);
    let x = rect.right - width * (state.buttons_to_right as i32 + 1);

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
        WM_CLOSE => uninstall(hwnd),
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// Процедура оверлея. Единственная задача — отвечать `HTMAXBUTTON`.
unsafe extern "system" fn overlay_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        // Ключевой ответ: после него Windows 11 показывает меню привязки.
        WM_NCHITTEST => return HTMAXBUTTON as LRESULT,
        WM_NCMOUSEMOVE => {
            let parent = GetParent(hwnd);
            let entered = with_overlay(parent, |state| {
                if state.hovering {
                    false
                } else {
                    state.hovering = true;
                    true
                }
            })
            .unwrap_or(false);
            if entered {
                emit_to(parent, EVENT_CAPTION_HOVER, true);
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
                state.hovering = false;
                state.pressed = false;
            });
            emit_to(parent, EVENT_CAPTION_HOVER, false);
            return 0;
        }
        WM_NCLBUTTONDOWN => {
            let parent = GetParent(hwnd);
            with_overlay(parent, |state| {
                state.pressed = true;
            });
            return 0;
        }
        WM_NCLBUTTONUP => {
            let parent = GetParent(hwnd);
            let clicked = with_overlay(parent, |state| {
                let pressed = state.pressed;
                state.pressed = false;
                pressed
            })
            .unwrap_or(false);
            // Клик отправляем в webview: разворотом занимается существующая
            // команда `window_maximize`, чтобы логика осталась в одном месте.
            if clicked {
                emit_to(parent, EVENT_CAPTION_CLICK, ());
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