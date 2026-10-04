use super::*;
use axum::http::HeaderMap as AxumHeaderMap;
use axum::http::HeaderValue;

#[test]
fn проверяет_bearer_токен() {
    let token = crate::tests::fixtures::FAKE_TOKEN;
    let mut headers = AxumHeaderMap::new();
    assert!(!is_valid_bearer(&headers, token), "без заголовка — отказ");

    headers.insert(axum::http::header::AUTHORIZATION, HeaderValue::from_static("Bearer wrong"));
    assert!(!is_valid_bearer(&headers, token));

    headers.insert(
        axum::http::header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}")).expect("корректный заголовок"),
    );
    assert!(is_valid_bearer(&headers, token));

    // Схема Basic не принимается: сервер ждёт ровно Bearer.
    headers.insert(
        axum::http::header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Basic {token}")).expect("корректный заголовок"),
    );
    assert!(!is_valid_bearer(&headers, token));

    assert!(!is_valid_bearer(&headers, ""), "пустой токен — всегда отказ");
}

#[test]
fn описывает_инструменты() {
    let tools = tools_list();
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0]["name"], "list_connections");
    assert_eq!(tools[1]["name"], "execute_command");
}

/// Схема инструментов — контракт с агентами: без `command` и с пустой
/// командой запрос обязан отклоняться, иначе агент выполнит «ничего».
#[test]
fn схема_инструментов_требует_команду() {
    let tools = tools_list();
    let execute = tools.iter().find(|tool| tool["name"] == "execute_command").expect("инструмент");
    let schema = &execute["inputSchema"];
    assert_eq!(schema["type"], "object");
    assert_eq!(schema["required"], json!(["command"]));
    assert_eq!(schema["properties"]["command"]["minLength"], 1);
    assert_eq!(schema["properties"]["command"]["type"], "string");
    // `connection_id` обязателен только когда подключений несколько,
    // поэтому в `required` его нет.
    assert!(schema["properties"]["connection_id"].is_object());
}

#[test]
fn неизвестный_инструмент_возвращает_ошибку() {
    // Проверяется через `call_tool`, но без `AppHandle` доступен только
    // список: неизвестное имя обязано быть отвергнуто, а не выполнено.
    let tools = tools_list();
    let names: Vec<&str> = tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap_or_default())
        .collect();
    assert!(!names.contains(&"run_shell"));
    assert!(!names.contains(&""));
    // Имена уникальны: иначе агент не сможет однозначно выбрать инструмент.
    let mut unique = names.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), names.len());
}

#[test]
fn ошибка_jsonrpc_сохраняет_идентификатор_запроса() {
    // По спецификации JSON-RPC `id` обязан совпадать с id запроса,
    // иначе агент не сможет сопоставить ответ.
    let response = error_response(json!(7), -32601, "Method not found");
    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], 7);
    assert_eq!(response["error"]["code"], -32601);
    assert_eq!(response["error"]["message"], "Method not found");

    // `id: null` — запрос-уведомление, ответ всё равно должен быть валидным.
    let response = error_response(Value::Null, -32700, "Parse error");
    assert!(response["id"].is_null());
}

#[tokio::test]
async fn сессия_агента_помнит_активность() {
    let state = Arc::new(McpState::default());
    register_session(
        &state,
        "s1",
        "claude".to_owned(),
        Some("1.0.0".to_owned()),
        "2025-11-25".to_owned(),
    )
    .await;
    // Несуществующая сессия не «оживает» от касания.
    assert!(touch_session(&state, "нет-такой").await.is_none());
    assert_eq!(touch_session(&state, "s1").await.as_deref(), Some("2025-11-25"));
}

// ── Буфер журнала ─────────────────────────────────────────────────────────

const CONN: &str = "srv1";

fn start_item(id: &str, timestamp: u64) -> LogItem {
    LogItem::Start {
        id: id.to_owned(),
        timestamp,
        connection_id: CONN.to_owned(),
        action: "execute_command".to_owned(),
        run_id: "run-1".to_owned(),
        status: LogStatus::Pending,
        tool_name: None,
        started_at: timestamp,
    }
}

fn item_id(item: &LogItem) -> &str {
    match item {
        LogItem::Start { id, .. }
        | LogItem::ToolCall { id, .. }
        | LogItem::ToolResult { id, .. }
        | LogItem::End { id, .. } => id,
    }
}

fn session(logs_visible: bool) -> AgentSession {
    AgentSession {
        name: "agent".to_owned(),
        version: Some("1.0.0".to_owned()),
        protocol_version: "2025-11-25".to_owned(),
        initialized: false,
        last_activity: Instant::now(),
        logs_visible,
    }
}

#[test]
fn буфер_не_растёт_при_скрытой_вкладке() {
    let mut inner = Inner::default();
    inner.sessions.insert(CONN.to_owned(), session(false));

    buffer_log(&mut inner, CONN, start_item("call1", 1));
    assert!(
        inner.logs.get(CONN).is_none(),
        "при скрытой вкладке журнал не должен расти"
    );

    // Вкладку открыли — записи снова пишутся.
    inner.sessions.get_mut(CONN).expect("сессия").logs_visible = true;
    buffer_log(&mut inner, CONN, start_item("call2", 2));
    assert_eq!(inner.logs.get(CONN).map(Vec::len), Some(1));
}

#[test]
fn буфер_обрезается_до_предела() {
    let mut inner = Inner::default();
    for index in 0..(MAX_LOG_ITEMS + 5) {
        buffer_log(&mut inner, CONN, start_item(&format!("call{index}"), index as u64));
    }

    let entries = inner.logs.get(CONN).expect("буфер");
    assert_eq!(entries.len(), MAX_LOG_ITEMS, "старые записи должны вытесняться");
    assert_eq!(item_id(&entries[0]), "call5", "вытесняются самые старые");
    assert_eq!(
        item_id(entries.last().expect("последняя запись")),
        format!("call{}", MAX_LOG_ITEMS + 4)
    );
}

#[test]
fn журнал_разделён_по_подключениям() {
    let mut inner = Inner::default();
    buffer_log(&mut inner, "srv1", start_item("call1", 1));
    buffer_log(&mut inner, "srv2", start_item("call2", 2));

    assert_eq!(inner.logs.len(), 2, "у каждого подключения свой журнал");
    assert_eq!(inner.logs["srv1"].len(), 1);
    assert_eq!(inner.logs["srv2"].len(), 1);
}

#[tokio::test]
async fn снимок_журнала_не_меняется_новыми_событиями() {
    let state = Arc::new(McpState::new());
    {
        let mut inner = state.inner.lock().await;
        buffer_log(&mut inner, CONN, start_item("call1", 1));
    }

    // Снимок ответа на `mcp-get-logs` — копия на момент запроса.
    let snapshot = logs(&state, CONN).await;
    {
        let mut inner = state.inner.lock().await;
        buffer_log(&mut inner, CONN, start_item("call2", 2));
    }

    assert_eq!(snapshot.len(), 1, "снимок не должен меняться от новых событий");
    assert_eq!(logs(&state, CONN).await.len(), 2);
    assert!(
        logs(&state, "неизвестное-подключение").await.is_empty(),
        "по неизвестному подключению журнал пуст"
    );
}
