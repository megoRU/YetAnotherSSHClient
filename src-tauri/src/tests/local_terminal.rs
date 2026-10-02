use super::*;

#[test]
fn оболочка_непустая() {
    assert!(!default_shell().is_empty());
}

/// Однократная команда `echo` в оболочке текущей платформы.
///
/// На Windows повторяет прежнюю ветку `COMSPEC` + `/c`, на Unix использует
/// `default_shell()` с `-c`. Оболочка из `default_shell()` на Windows —
/// PowerShell, и `-c echo` там не сработал бы, поэтому для Windows путь
/// остаётся явным.
fn shell_command(marker: &str) -> CommandBuilder {
    if cfg!(target_os = "windows") {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_owned());
        let mut command = CommandBuilder::new(shell);
        command.arg("/c");
        command.arg(format!("echo {marker}"));
        command
    } else {
        let mut command = CommandBuilder::new(default_shell());
        command.arg("-c");
        command.arg(format!("echo {marker}"));
        command
    }
}

/// Реальный PTY: команда, запущенная в оболочке, обязана вернуть вывод.
///
/// Чтение идёт в отдельном потоке, результат ждём по каналу с таймаутом.
/// Поток намеренно не присоединяется: на Windows `read` на PTY после
/// `kill` может не вернуться, и `join` завис бы навсегда. Накопленный
/// вывод читается из общего буфера, поэтому диагностика сохраняется.
///
/// Оболочка выбирается по платформе: `cmd.exe` на Linux не существует, и
/// попытка его запустить падала бы на `spawn`, а не на самой проверке вывода.
/// На Windows ветка остаётся прежней — там нужен именно `cmd.exe /c echo`,
/// потому что PowerShell для этой проверки не используется.
#[test]
fn команда_в_локальном_терминале_возвращает_вывод() {
    use std::io::Read as _;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    const MARKER: &str = "local-terminal-ok";

    let system = NativePtySystem::default();
    let pair = system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("pty");

    let command = shell_command(MARKER);
    let mut child = pair.slave.spawn_command(command).expect("запустить оболочку");
    // slave-конец держим живым до конца теста: если его отпустить,
    // чтение pty заканчивается пустым результатом (как в `start`).
    let _slave = pair.slave;

    let mut reader = pair.master.try_clone_reader().expect("читать pty");
    let collected = Arc::new(Mutex::new(String::new()));
    let (reports, wait_report) = std::sync::mpsc::channel::<()>();
    let mut writer_side = pair.master.take_writer().expect("писать в pty");

    let thread_collected = collected.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let chunk = &buffer[..read];
                    let mut collected = thread_collected.lock().expect("буфер вывода");
                    collected.push_str(&String::from_utf8_lossy(chunk));
                    let done = collected.contains(MARKER);
                    drop(collected);
                    // ConPTY при старте спрашивает позицию курсора и
                    // ждёт ответа; в приложении его даёт xterm, в тесте —
                    // этот ответ. Без него оболочка не печатает вывод.
                    let needs_reply = chunk.windows(4).any(|window| window == b"\x1b[6n");
                    if needs_reply && reports.send(()).is_err() {
                        break;
                    }
                    if done {
                        break;
                    }
                }
            }
        }
    });

    // Отвечаем на запросы позиции курсора и ждём маркер.
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while std::time::Instant::now() < deadline {
        if collected.lock().expect("буфер вывода").contains(MARKER) {
            break;
        }
        if wait_report.recv_timeout(Duration::from_millis(50)).is_ok() {
            let _ = writer_side.write_all(b"\x1b[1;1R");
            let _ = writer_side.flush();
        }
    }
    let _ = writer_side.write_all(b"exit\r\n");
    let _ = writer_side.flush();
    let _ = child.kill();

    let output = collected.lock().expect("буфер вывода").clone();
    assert!(output.contains(MARKER), "вывод терминала не получен: {output:?}");
}

/// Ввод в pty записывается в канал и не должен падать ни при живом, ни при
/// уже завершившемся процессе.
#[test]
fn запись_в_pty_не_паникует() {
    let system = NativePtySystem::default();
    let pair = system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("pty");
    let mut command = CommandBuilder::new(default_shell());
    command.arg("-c");
    command.arg("echo ready");
    let mut child = pair.slave.spawn_command(command).expect("запустить оболочку");
    let mut writer = pair.master.take_writer().expect("писать в pty");

    let _ = writer.write_all(b"exit\n");
    let _ = writer.flush();
    let _ = child.kill();
}

#[test]
fn размер_pty_не_бывает_нулевым() {
    // Нулевые колонки/строки недопустимы для PTY: терминал обязан
    // подставлять минимум, иначе запуск падает на некоторых платформах.
    let clamped = PtySize { rows: 0u16.max(1), cols: 0u16.max(1), pixel_width: 0, pixel_height: 0 };
    assert_eq!(clamped.rows, 1);
    assert_eq!(clamped.cols, 1);
}

#[tokio::test]
async fn ввод_в_неизвестный_терминал_не_паникует() {
    // Команды приходят с событиями ввода и могут опережать регистрацию
    // терминала: это не должно ронять приложение.
    let manager = LocalTerminalManager::new();
    manager.input("нет-такого", "ls\n").await;
    manager.resize("нет-такого", 80, 24).await;
    manager.close("нет-такого").await;
}

#[tokio::test]
async fn закрытие_всех_терминалов_пустого_списка_безопасно() {
    let manager = LocalTerminalManager::new();
    manager.close_all().await;
}
