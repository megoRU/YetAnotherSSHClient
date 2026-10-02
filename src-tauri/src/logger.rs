//! Кольцевой буфер логов main-процесса — порт `electron/src/logger.ts`.
//!
//! Electron перехватывал `console.*`; в Rust перехватывать нечего, поэтому
//! модуль предоставляет явные функции записи, а экспорт логов собирает из буфера
//! тот же текстовый формат, что ожидает UI (`export-logs`).

use std::collections::VecDeque;
use std::io::Write;
use std::sync::{Mutex, OnceLock};

use crate::paths;
use crate::sanitize;

const MAX_LOG_ENTRIES: usize = 2000;

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: Level,
    pub scope: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
    Debug,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
            Level::Debug => "DEBUG",
        }
    }

    /// Понимает значения, которые присылает renderer (`log-renderer-msg`).
    pub fn parse(value: &str) -> Level {
        match value.to_ascii_uppercase().as_str() {
            "WARN" | "WARNING" => Level::Warn,
            "ERROR" => Level::Error,
            "DEBUG" | "TRACE" => Level::Debug,
            _ => Level::Info,
        }
    }
}

fn buffer() -> &'static Mutex<VecDeque<LogEntry>> {
    static BUFFER: OnceLock<Mutex<VecDeque<LogEntry>>> = OnceLock::new();
    BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(256)))
}

static INITIALIZED: OnceLock<bool> = OnceLock::new();

/// Фиксирует старт приложения в буфере логов (идемпотентно).
pub fn init(app_version: &str) {
    if INITIALIZED.get().is_some() {
        return;
    }
    let _ = INITIALIZED.set(true);
    add(Level::Info, "System", &format!("Logger initialized. App version: {app_version}"));
}

/// Записывается ли сообщение ещё и в консоль.
///
/// Консоль нужна только при отладке: в релизной сборке на Windows
/// `windows_subsystem = "windows"` не создаёт ни stdout, ни stderr, поэтому
/// запись уходит в никуда, но синхронно и с аллокацией строки на каждом
/// сообщении. На macOS и Linux терминал у релизной сборки есть, и вывод в
/// него полезен, поэтому там поведение прежнее.
fn writes_to_console() -> bool {
    cfg!(debug_assertions) || !cfg!(target_os = "windows")
}

pub fn add(level: Level, scope: &str, message: &str) {
    let entry = LogEntry {
        timestamp: now_iso8601(),
        level,
        scope: scope.to_owned(),
        message: sanitize::sanitize_text(message),
    };

    if writes_to_console() {
        match level {
            Level::Error | Level::Warn => {
                eprintln!("[{}] [{}] {}", entry.timestamp, entry.level.as_str(), entry.message);
            }
            _ => {
                let _ = std::io::stdout().write_all(
                    format!("[{}] [{}] {}\n", entry.timestamp, entry.level.as_str(), entry.message).as_bytes(),
                );
            }
        }
    }

    if let Ok(mut guard) = buffer().lock() {
        if guard.len() >= MAX_LOG_ENTRIES {
            guard.pop_front();
        }
        guard.push_back(entry);
    }
}

pub fn info(scope: &str, message: &str) {
    add(Level::Info, scope, message);
}

pub fn warn(scope: &str, message: &str) {
    add(Level::Warn, scope, message);
}

pub fn error(scope: &str, message: &str) {
    add(Level::Error, scope, message);
}

pub fn debug(scope: &str, message: &str) {
    add(Level::Debug, scope, message);
}

/// Технический текст ошибки, который не должен попадать в UI.
pub fn internal(message: &str) {
    add(Level::Debug, "Internal", message);
}

/// Снимок буфера (копия — вызывающая сторона не должна влиять на состояние).
pub fn snapshot() -> Vec<LogEntry> {
    buffer()
        .lock()
        .map(|guard| guard.iter().cloned().collect())
        .unwrap_or_default()
}

/// Полный текст логов для экспорта (формат сохранён из Electron-версии).
pub fn export_text(app_version: &str) -> String {
    let now = now_iso8601();
    let uptime = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Версия ОС необязательна: на платформах, где её нечем узнать, скобки
    // опускаются. Раньше здесь всегда печаталось `(unknown)` — на Windows и
    // macOS, потому что читался только Linux-путь `procfs`.
    let platform = match paths::os_release() {
        Some(release) => format!(
            "{} {} ({release})",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
        None => format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
    };

    let mut lines = vec![
        "========================================================================".to_owned(),
        "YetAnotherSSHClient Session Logs".to_owned(),
        format!("Export Time: {now}"),
        format!("App Version: {app_version}"),
        format!("OS Platform: {platform}"),
        format!("System Uptime: {uptime}s"),
        "========================================================================".to_owned(),
        String::new(),
    ];

    for entry in snapshot() {
        lines.push(format!(
            "[{}] [{}] [{}] {}",
            entry.timestamp,
            entry.level.as_str(),
            entry.scope,
            entry.message
        ));
    }

    lines.join("\n")
}

fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
#[path = "tests/logger.rs"]
mod tests;
