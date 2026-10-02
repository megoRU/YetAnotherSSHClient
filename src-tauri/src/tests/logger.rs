use super::*;

#[test]
fn экспорт_содержит_заголовок_и_записи() {
    add(Level::Info, "Test", "token=abc");
    let text = export_text("4.0.0");
    assert!(text.contains("YetAnotherSSHClient Session Logs"));
    assert!(!text.contains("token=abc"));
    assert!(text.contains("token=[REDACTED]"));
}

/// `Node Version` — наследие Electron-сборки: в Tauri рантайма Node нет, и
/// строка `n/a (Tauri/Rust)` только путала тех, кто читает логи.
#[test]
fn в_заголовке_нет_строки_про_node() {
    let text = export_text("4.0.0");
    assert!(!text.contains("Node Version"));
    assert!(!text.contains("n/a (Tauri/Rust)"));
    assert!(text.contains("OS Platform:"));
}

/// Renderer присылает уровень строкой; неизвестное значение не должно
/// превращать обычное сообщение в ошибку.
#[test]
fn уровень_из_renderer_разбирается() {
    assert_eq!(Level::parse("info"), Level::Info);
    assert_eq!(Level::parse("INFO"), Level::Info);
    assert_eq!(Level::parse("warn"), Level::Warn);
    assert_eq!(Level::parse("WARNING"), Level::Warn);
    assert_eq!(Level::parse("error"), Level::Error);
    assert_eq!(Level::parse("debug"), Level::Debug);
    assert_eq!(Level::parse("trace"), Level::Debug);
    assert_eq!(Level::parse("что-то"), Level::Info);
    assert_eq!(Level::parse(""), Level::Info);
}

#[test]
fn уровень_имеет_ожидаемое_имя_в_экспорте() {
    // Формат строки экспорта читают и разработчики, и пользователи в
    // баг-репортах: менять имена уровней нельзя.
    assert_eq!(Level::Info.as_str(), "INFO");
    assert_eq!(Level::Warn.as_str(), "WARN");
    assert_eq!(Level::Error.as_str(), "ERROR");
    assert_eq!(Level::Debug.as_str(), "DEBUG");
}

/// Буфер кольцевой: при переполнении вытесняются самые старые записи,
/// чтобы логи не разрастались в памяти за всю сессию.
#[test]
fn буфер_не_растёт_бесконечно() {
    add(Level::Debug, "Ring", "маркер-начала");
    for index in 0..MAX_LOG_ENTRIES * 2 {
        add(Level::Debug, "Ring", &format!("запись-{index}"));
    }
    let entries = snapshot();
    assert_eq!(entries.len(), MAX_LOG_ENTRIES, "размер буфера не ограничен");
    // Свежие записи на месте, самые старые вытеснены.
    let last = entries.last().expect("записи есть");
    assert!(last.message.contains(&format!("запись-{}", MAX_LOG_ENTRIES * 2 - 1)));
    assert!(!entries.iter().any(|entry| entry.message.contains("маркер-начала")));
}

#[test]
fn снимок_буфера_не_влияет_на_состояние() {
    // Буфер общий для всего процесса, поэтому проверяем именно
    // независимость копии, а не её длину: параллельные тесты дописывают
    // в буфер свои записи.
    add(Level::Info, "Snapshot", "первая");
    let mut copy = snapshot();
    assert!(copy.iter().any(|entry| entry.message == "первая"));
    copy.clear();
    assert!(copy.is_empty(), "очистка копии не должна ничего делать с буфером");
    assert!(snapshot().iter().any(|entry| entry.message == "первая"));
}

#[test]
fn запись_из_рендерера_санитизируется() {
    // Секрет из renderer не должен попасть в буфер в открытом виде.
    add(Level::Info, "Renderer", "Authorization: Bearer secret-token-value");
    let entries = snapshot();
    let entry = entries.last().expect("запись есть");
    assert!(!entry.message.contains("secret-token-value"));
    assert!(entry.message.contains("[REDACTED]"));
}
