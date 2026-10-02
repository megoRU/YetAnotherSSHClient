// Точка входа бинарника: только вызов библиотечной `run`, как в шаблоне Tauri.
// Всё остальное живёт в `lib.rs`, чтобы логика была доступна интеграционным
// тестам и мобильным точкам входа.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    yassh_client_lib::run()
}
