//! Локальный терминал — порт `electron/src/local-terminal.ts`.
//!
//! Используется `portable-pty`: на Windows это ConPTY, на Unix — настоящий pty.
//! Вывод читается в отдельном потоке и отправляется в webview каналом рендерера
//! сырыми байтами; завершение процесса — как `local-terminal-exit-${id}` с
//! кодом возврата.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

#[cfg(not(windows))]
use portable_pty::ChildKiller;
use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::logger;

/// Оболочка по умолчанию для текущей платформы.
///
/// На Windows предпочитаем PowerShell, затем оболочку из `COMSPEC` и `cmd.exe`;
/// на Unix берём `SHELL`, затем типовые пути и `/bin/sh`.
pub fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        // PowerShell даёт ожидаемые для интерактивного терминала команды
        // (например, `clear`/`cls`) и доступен в поддерживаемых Windows.
        if let Some(shell) = find_on_path("pwsh.exe") {
            return shell;
        }
        if let Ok(system_root) = std::env::var("SystemRoot") {
            let windows_powershell = std::path::Path::new(&system_root)
                .join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
            if windows_powershell.is_file() {
                return windows_powershell.to_string_lossy().into_owned();
            }
        }
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

fn find_on_path(executable: &str) -> Option<String> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join(executable))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

/// Живой локальный терминал: ввод, изменение размеров и убийство процесса.
///
/// Убийтель отделён от `Child`, потому что ожидание завершения процесса живёт
/// в отдельной задаче (код возврата уходит в webview), а закрытие вкладки
/// должно работать и до, и после неё.
pub struct LocalTerminal {
    #[cfg(windows)]
    _process_job: std::os::windows::io::OwnedHandle,
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    #[cfg(not(windows))]
    killer: Box<dyn ChildKiller + Send + Sync>,
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
    ///
    /// `output_channel` — канал сырого вывода из рендерера; обязателен, другого
    /// пути доставки вывода нет.
    pub async fn start(
        &self,
        app: &AppHandle,
        id: &str,
        shell: &str,
        args: &[String],
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
        output_channel: Channel<InvokeResponseBody>,
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

            #[cfg(windows)]
            let process_job = windows_job::create().map_err(|err| err.to_string())?;
            let reader = pair
                .master
                .try_clone_reader()
                .map_err(|err| format!("Не удалось прочитать PTY: {err}"))?;
            let writer = pair.master.take_writer().map_err(|err| err.to_string())?;
            let child = pair
                .slave
                .spawn_command(command)
                .map_err(|err| format!("Не удалось запустить оболочку: {err}"))?;
            #[cfg(windows)]
            if let Err(err) = windows_job::assign(&process_job, child.as_ref()) {
                let _ = child.clone_killer().kill();
                return Err(err.to_string());
            }
            // У оболочки уже есть slave-дескрипторы. На Windows единственная
            // ссылка на псевдоконсоль должна остаться у master.
            drop(pair.slave);

            let pid = child.process_id().unwrap_or(0);
            Ok(PtyCreation {
                pid,
                reader,
                writer,
                master: pair.master,
                #[cfg(windows)]
                process_job,
                #[cfg(not(windows))]
                killer: child.clone_killer(),
                child,
            })
        })
        .await
        .map_err(|err| err.to_string())??;

        let PtyCreation {
            pid,
            mut reader,
            writer,
            master,
            #[cfg(windows)]
            process_job,
            #[cfg(not(windows))]
            killer,
            mut child,
        } = created;
        let id_owned = id.to_owned();

        // Чтение pty: вывод уходит в webview каналом рендерера сырыми байтами.
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<Vec<u8>>(8);
        std::thread::spawn(move || {
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
            while let Some(chunk) = receiver.recv().await {
                if chunk.is_empty() {
                    break;
                }
                let _ = output_channel.send(InvokeResponseBody::Raw(chunk));
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
        });

        self.terminals.lock().await.insert(
            id_owned,
            LocalTerminal {
                #[cfg(windows)]
                _process_job: process_job,
                writer,
                master,
                #[cfg(not(windows))]
                killer,
            },
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
        if let Some(terminal) = terminal {
            let _ = tauri::async_runtime::spawn_blocking(move || {
                #[cfg(not(windows))]
                {
                    let mut terminal = terminal;
                    let _ = terminal.killer.kill();
                }
                // ConPTY может блокироваться до окончания чтения вывода.
                #[cfg(windows)]
                drop(terminal);
            })
            .await;
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
    #[cfg(windows)]
    process_job: std::os::windows::io::OwnedHandle,
    #[cfg(not(windows))]
    killer: Box<dyn ChildKiller + Send + Sync>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[cfg(windows)]
mod windows_job {
    use std::io;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::ptr;

    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub(super) fn create() -> io::Result<OwnedHandle> {
        let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }
        // Дескриптор не наследуется. При выходе Windows закрывает его и
        // завершает всю группу процессов локального терминала.
        let job = unsafe { OwnedHandle::from_raw_handle(job) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let result = unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                ptr::from_ref(&limits).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if result == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    pub(super) fn assign(job: &OwnedHandle, child: &dyn portable_pty::Child) -> io::Result<()> {
        let process = child.as_raw_handle().ok_or_else(|| io::Error::other("Missing shell process handle"))?;
        let result = unsafe { AssignProcessToJobObject(job.as_raw_handle(), process) };
        if result == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

/// Тип общего владения терминалом (используется в хелперах).
pub type SharedTerminal = Arc<LocalTerminal>;

#[cfg(test)]
#[path = "tests/local_terminal.rs"]
mod tests;
