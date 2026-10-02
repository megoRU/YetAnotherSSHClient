//! Точка входа приложения на Tauri 2.
//!
//! Сборка `tauri::generate_context!()` читает `tauri.conf.json`, а набор
//! команд формируется [`generate_handler`]: имена команд совпадают с каналами
//! Electron, поэтому фронтенд переключается на мост без переписывания.

pub mod commands;
pub mod commands_sftp;
pub mod config;
pub mod error;
pub mod i18n;
pub mod keychain;
pub mod keys;
pub mod local_terminal;
pub mod logger;
pub mod mcp;
pub mod paths;
pub mod sanitize;
pub mod sftp;
pub mod ssh;
pub mod state;
pub mod telemetry;
pub mod updates;
pub mod vault;
pub mod window;

#[cfg(test)]
mod tests;

use std::time::Duration;

use tauri::Manager;

use crate::state::AppState;

/// Отложенная проверка обновлений (не чаще раза в 6 часов).
const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// Пауза перед первой фоновой проверкой: не мешает первому кадру.
const FIRST_UPDATE_CHECK_DELAY: Duration = Duration::from_secs(5);

/// Пауза перед отправкой телеметрии: не мешает первому кадру.
const TELEMETRY_DELAY: Duration = Duration::from_secs(3);

/// Запуск приложения.
pub fn run() {
    logger::init(env!("CARGO_PKG_VERSION"));
    // Язык сообщений main-процесса синхронизируется с конфигом до первого
    // события: иначе первая ошибка была бы на языке по умолчанию.
    i18n::set_language(&config::load().language);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Второй экземпляр не запускаем: показываем уже открытое окно.
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();

            // Конфиг читается до создания окна: он задаёт геометрию, тему и
            // синхронный снимок для `getConfigSync()`.
            window::create_main_window(&handle)?;
            window::attach_listeners(&handle);

            if let Some(state) = handle.try_state::<AppState>() {
                let app = handle.clone();
                let mcp_state = state.mcp.clone();
                tauri::async_runtime::spawn(async move {
                    mcp::sync_state(&app, &mcp_state).await;
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == window::MAIN_WINDOW {
                    // Окно закрыто: закрываем все соединения и MCP явно, иначе
                    // фоновые задачи продолжат держать процесс живым.
                    let handle = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(state) = handle.try_state::<AppState>() {
                            state.terminals.cleanup_all().await;
                            state.sftp.close_all().await;
                            state.local_terminals.close_all().await;
                            mcp::stop(&handle, &state.mcp, false).await;
                        }
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Конфигурация
            commands::get_config,
            commands::get_config_async,
            commands::save_config,
            commands::renderer_content_ready,
            commands::export_config,
            commands::import_config,
            commands::export_logs,
            commands::log_renderer_msg,
            // Вольт
            commands::vault_get_status,
            commands::vault_init,
            commands::vault_unlock,
            commands::vault_get_recovery_key,
            commands::vault_get_password,
            commands::vault_regenerate_key,
            commands::vault_reset,
            // Система
            commands::platform,
            commands::select_key_file,
            commands::load_private_key_file,
            commands::select_executable_file,
            commands::read_clipboard_text,
            commands::encrypt_private_key,
            commands::open_external,
            commands::fs_stat,
            // Окно
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
            commands::window_flash,
            // SSH
            commands::ssh_connect,
            commands::ssh_auth_response,
            commands::ssh_input,
            commands::ssh_resize,
            commands::ssh_get_os_info,
            commands::ssh_close,
            commands::ssh_clear_fingerprint,
            commands::ssh_fingerprint_response,
            commands::ssh_forward_start,
            commands::ssh_forward_stop,
            // SFTP
            commands_sftp::sftp_connect,
            commands_sftp::sftp_realpath,
            commands_sftp::sftp_readdir,
            commands_sftp::sftp_mkdir,
            commands_sftp::sftp_rm,
            commands_sftp::sftp_rename,
            commands_sftp::sftp_chmod,
            commands_sftp::sftp_extract,
            commands_sftp::sftp_download_file,
            commands_sftp::sftp_download_multiple_files,
            commands_sftp::sftp_upload_files_from_paths,
            commands_sftp::sftp_upload_direct,
            commands_sftp::sftp_cancel_upload,
            commands_sftp::sftp_open_in_editor,
            commands_sftp::sftp_open_with,
            commands_sftp::sftp_select_files,
            // Локальный терминал
            commands::local_terminal_start,
            commands::local_terminal_input,
            commands::local_terminal_resize,
            commands::local_terminal_close,
            // MCP
            commands::mcp_get_status,
            commands::mcp_get_token,
            commands::mcp_get_logs,
            commands::mcp_set_logs_visible,
            commands::mcp_toggle,
            commands::mcp_regenerate_token,
            commands::mcp_open_server,
            commands::mcp_close_server,
            commands::mcp_confirm_command,
            commands::mcp_cancel_run,
            // Обновления
            commands::check_updates,
            commands::start_update_download,
            commands::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(|app, event| match event {
            // Задачи, которые не должны конкурировать с первым рендером.
            tauri::RunEvent::Ready => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    start_post_show_tasks(handle).await;
                });
            }
            // Соединения закрываются в обработчике `WindowEvent::Destroyed`:
            // он срабатывает и при закрытии окна кнопкой, и при выходе из
            // приложения, тогда как `Exit` может прийти без него.
            _ => {}
        });
}

/// Задачи, которые не должны конкурировать с первым рендером.
async fn start_post_show_tasks(app: tauri::AppHandle) {
    // Осиротевшие временные каталоги — с задержкой, чтобы не тормозить запуск.
    let updater_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        paths::cleanup_orphaned_temp_dirs();
    });

    // Телеметрия — с задержкой, как и остальные фоновые задачи.
    //
    // `RunEvent::Ready` приходит, когда окно создано, но рендерер ещё не
    // показался: `renderer_content_ready` приходит заметно позже. Отправка
    // в этот момент строила `reqwest::Client`, который с rustls читает и
    // разбирает системное хранилище корневых сертификатов, — работа на
    // десятки миллисекунд CPU ровно тогда, когда WebView2 грузит и рисует
    // первый кадр. Теперь клиент поднимается после паузы, когда первый
    // кадр уже показан.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(TELEMETRY_DELAY).await;
        telemetry::send().await;
    });

    // Фоновая проверка идёт на всех платформах, включая macOS: приложение
    // распространяется через DMG с GitHub Releases, а не через Mac App Store,
    // поэтому правила App Store на него не распространяются. Раньше проверка
    // на macOS была отключена — ограничение перешло из Electron-версии, где
    // подписанный `.app.tar.gz` не использовался.
    let handle = updater_app.clone();
    tauri::async_runtime::spawn(async move {
        // Первая проверка — через стартовую задержку, дальше раз в
        // `UPDATE_CHECK_INTERVAL`, пока приложение открыто. Раньше тик был
        // один, и приложение, оставленное запущенным на сутки, обновление
        // так и не увидело бы.
        let mut delay = FIRST_UPDATE_CHECK_DELAY;
        loop {
            tokio::time::sleep(delay).await;
            delay = UPDATE_CHECK_INTERVAL;

            let Some(state) = handle.try_state::<AppState>() else { continue };
            // Троттлинг между запусками: приложение, перезапущенное раньше
            // интервала, новую проверку не делает.
            if !updates::should_check(&state.updater, UPDATE_CHECK_INTERVAL) {
                continue;
            }
            updates::set_last_check(&state.updater).await;
            // Фоновой проверке доступен только сохранённый конфиг: рендерер
            // к этому моменту мог ещё не сохранить настройку.
            let allow_pre_release = crate::config::load().allow_pre_release_updates;
            let _ = updates::check(&handle, &state.updater, allow_pre_release).await;
        }
    });

    // Страховка: рендерер сообщает о готовности через `renderer-content-ready`,
    // но если он не смог (ошибка загрузки), окно всё равно показывается.
    let fallback_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        let Some(state) = fallback_app.try_state::<AppState>() else { return };
        if state.window.lock().await.renderer_content_ready {
            return;
        }
        logger::warn("Window", "Renderer did not report content readiness before fallback timeout");
        state.window.lock().await.renderer_content_ready = true;
        window::show_if_ready(&fallback_app).await;
    });
}

/// Показывает и фокусирует главное окно (второй экземпляр приложения).
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(window::MAIN_WINDOW) {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}
