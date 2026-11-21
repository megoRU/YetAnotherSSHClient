#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).is_some_and(|arg| arg == "mcp") {
        yassh_client_lib::mcp::stdio::run();
    } else {
        yassh_client_lib::run();
    }
}
