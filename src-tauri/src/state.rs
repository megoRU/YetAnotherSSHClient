//! Глобальное состояние приложения, управляемое Tauri.
//!
//! Все долгоживущие реестры (SSH-сессии, SFTP, MCP, локальные терминалы,
//! автообновление) живут здесь, а не в глобальных переменных: так их видно в
//! подписи команд и проще тестировать.

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::local_terminal::LocalTerminalManager;
use crate::mcp::McpState;
use crate::sftp::SftpManager;
use crate::ssh::SessionRegistry;
use crate::updates::UpdaterState;
use crate::window::WindowState;

#[cfg(test)]
#[path = "tests/state.rs"]
mod tests;

pub struct AppState {
    /// SSH-сессии терминала и перенаправления портов.
    pub terminals: SessionRegistry,
    /// SFTP-соединения, трансферы и файловые операции.
    pub sftp: SftpManager,
    /// HTTP-сервер MCP и его менеджеры.
    pub mcp: Arc<McpState>,
    /// Локальные терминалы (ConPTY / pty).
    pub local_terminals: LocalTerminalManager,
    /// Состояние проверки/установки обновлений.
    pub updater: UpdaterState,
    /// Показ окна, геометрия и внимание пользователя.
    pub window: Mutex<WindowState>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            terminals: SessionRegistry::new(),
            sftp: SftpManager::new(),
            mcp: Arc::new(McpState::new()),
            local_terminals: LocalTerminalManager::new(),
            updater: UpdaterState::new(),
            window: Mutex::new(WindowState::default()),
        }
    }
}
