//! Локальный терминал — порт `electron/src/local-terminal.ts`.
//!
//! Используется `portable-pty`: на Windows это ConPTY, на Unix — настоящий pty.
//! Вывод читается в отдельном потоке и отправляется в webview как
//! `local-terminal-output-${id}`; завершение процесса — как
//! `local-terminal-exit-${id}` с кодом возврата.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::logger;

/// Оболочка по умолчанию для текущей платформы.
///
/// Порядок тот же, что в Electron-версии: переменные окружения (`COMSPEC`,
/// `SHELL`), затем типовые пути, затем `cmd.exe` / `/bin/sh`.
pub fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.is_empty() {
                return comspec;
            }
        }
        for candidate in ["C:\\Windows\\System32\\cmd.exe", "C:\\cmd.exe"] {
            if std::path::Path::new(candidate).exists() {
                return candidate.to_owned();
            }
        }
        "cmd.exe".to_owned()
    } else {
        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.is_empty() {
                return shell;
            }
        }
        for candidate in ["/bin/bash", "/bin/zsh", "/bin/sh"] {
            if std::path::Path::new(candidate).exists() {
                return candidate.to_owned();
            }
        }
        "/bin/sh".to_owned()
    }
}

/// Живой локальный терминал: ввод, изменение размеров и убийство процесса.
///
/// Убийтель отделён от `Child`, потому что ожидание завершения процесса живёт
/// в отдельной задаче (код возврата уходит в webview), а закрытие вкладки
/// должно работать и до, и после неё.
pub struct LocalTerminal {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    reader: Option<std::thread::JoinHandle<()>>,
}

impl LocalTerminal {
    /// Изменение размеров окна терминала.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|err| err.to_string())
    }

    pub fn write(&mut self, data: &str) {
        let _ = self.writer.write_all(data.as_bytes());
        let _ = self.writer.flush();
    }
}

#[derive(Default)]
pub struct LocalTerminalManager {
    terminals: Mutex<HashMap<String, LocalTerminal>>,
}

impl LocalTerminalManager {
    pub fn new() -> Self {
        LocalTerminalManager::default()
    }

    /// Создаёт PTY и возвращает pid процесса оболочки.
    pub async fn start(
        &self,
        app: &AppHandle,
        id: &str,
        shell: &str,
        args: &[String],
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> Result<u32, String> {
        self.close(id).await;

        let shell = shell.to_owned();
        let args = args.to_vec();
        let cwd_owned = cwd.map(|value| value.to_owned());
        let size = PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 };

        // Создание pty — системные вызовы, поэтому уводим их из async-контекста.
        let created = tauri::async_runtime::spawn_blocking(move || -> Result<PtyCreation, String> {
            let system = NativePtySystem::default();
            let pair: PtyPair = system.openpty(size).map_err(|err| format!("Не удалось создать PTY: {err}"))?;

            let mut command = CommandBuilder::new(shell);
            for arg in &args {
                command.arg(arg);
            }
            if let Some(directory) = cwd_owned.as_deref() {
                command.cwd(directory);
            }
            command.env("TERM", "xterm-256color");

            let mut child = pair
                .slave
                .spawn_command(command)
                .map_err(|err| format!("Не удалось запустить оболочку: {err}"))?;
            // slave держится открытым, пока жив slave-конец pty: иначе на Unix
            // чтение немедленно возвращает EOF.
            let slave = pair.slave;

            let mut reader = pair
                .master
                .try_clone_reader()
                .map_err(|err| format!("Не удалось прочитать PTY: {err}"))?;
            let writer = pair.master.take_writer().map_err(|err| err.to_string())?;

            let pid = child.process_id().unwrap_or(0);
            Ok(PtyCreation {
                pid,
                reader,
                writer,
                master: pair.master,
                killer: child.clone_killer(),
                child: Box::new(child),
                slave,
            })
        })
        .await
        .map_err(|err| err.to_string())??;

        let PtyCreation { pid, reader, writer, master, killer, mut child, slave } = created;
        let id_owned = id.to_owned();

        // Чтение pty: вывод уходит в webview как base64, чтобы не превращать
        // каждый байт в элемент JSON-массива.
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<Vec<u8>>(8);
        let app_out = app.clone();
        let id_out = id_owned.clone();
        let reader_task = std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        // `blocking_send` допустим: поток не асинхронный.
                        if sender.blocking_send(buffer[..read].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(err) => {
                        logger::debug("LocalTerminal", &format!("PTY read finished: {err}"));
                        break;
                    }
                }
            }
        });

        tauri::async_runtime::spawn(async move {
            use base64::Engine as _;
            use base64::engine::general_purpose::STANDARD;
            while let Some(chunk) = receiver.recv().await {
                if chunk.is_empty() {
                    break;
                }
                let _ = app_out.emit(&format!("local-terminal-output-{id_out}"), STANDARD.encode(chunk));
            }
        });

        // Ожидание завершения процесса: код возврата уходит в webview.
        let app_exit = app.clone();
        let id_exit = id_owned.clone();
        tauri::async_runtime::spawn(async move {
            let exit_code = tauri::async_runtime::spawn_blocking(move || {
                child.wait().map(|status| status.exit_code() as i32).unwrap_or(0)
            })
            .await
            .unwrap_or(0);
            let _ = app_exit.emit(&format!("local-terminal-exit-{id_exit}"), exit_code);
            // slave освобождается только после завершения оболочки: иначе на
            // Unix чтение pty оборвалось бы раньше времени.
            drop(slave);
        });

        self.terminals.lock().await.insert(
            id_owned,
            LocalTerminal { writer, master, killer, reader: Some(reader_task) },
        );

        Ok(pid)
    }

    /// Ввод данных в локальный терминал.
    pub async fn input(&self, id: &str, data: &str) {
        if let Some(terminal) = self.terminals.lock().await.get_mut(id) {
            terminal.write(data);
        }
    }

    /// Изменение размеров локального терминала.
    pub async fn resize(&self, id: &str, cols: u16, rows: u16) {
        if let Some(terminal) = self.terminals.lock().await.get_mut(id) {
            if let Err(err) = terminal.resize(cols, rows) {
                logger::warn("LocalTerminal", &format!("Resize failed: {err}"));
            }
        }
    }

    /// Закрытие локального терминала.
    pub async fn close(&self, id: &str) {
        let terminal = self.terminals.lock().await.remove(id);
        if let Some(mut terminal) = terminal {
            let _ = terminal.killer.kill();
            if let Some(reader) = terminal.reader.take() {
                let _ = reader.join();
            }
        }
    }

    /// Закрывает все локальные терминалы (выход из приложения).
    pub async fn close_all(&self) {
        let ids: Vec<String> = self.terminals.lock().await.keys().cloned().collect();
        for id in ids {
            self.close(&id).await;
        }
    }
}

/// Результат создания PTY в блокирующем потоке.
struct PtyCreation {
    pid: u32,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    slave: Box<dyn portable_pty::SlavePty + Send>,
}

/// Тип общего владения терминалом (используется в хелперах).
pub type SharedTerminal = Arc<LocalTerminal>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn оболочка_непустая() {
        assert!(!default_shell().is_empty());
    }
}
