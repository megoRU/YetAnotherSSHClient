//! MCP-сервер — порт `electron/src/mcp/`.
//!
//! Внешний контракт сохранён полностью:
//! * HTTP `POST /mcp` на `<mcpListenAddress>:<mcpPort>` (`127.0.0.1` по умолчанию),
//!   авторизация `Bearer <mcpToken>`;
//! * лимит тела 1 МБ, `404` на неизвестный путь, `401` на неверный токен;
//! * сессии по заголовку `mcp-session-id`, `404` (код `-32001`) на неизвестную;
//! * инструменты `list_connections` и `execute_command`;
//! * подтверждение команд через UI: `mcp-request-confirmation` →
//!   `mcp-confirm-command`;
//! * события `mcp-status-changed`, `mcp-log`, `mcp-request-confirmation`.
//!
//! Отличие: вместо `@modelcontextprotocol/sdk` протокол JSON-RPC/MCP
//! реализован напрямую (axum + serde_json). Это убирает самый тяжёлый
//! транзитивный граф зависимостей и оставляет ~400 строк понятного кода
//! вместо SDK-обвязки.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

use crate::config::{AppConfig, DEFAULT_MCP_LISTEN_ADDRESS};
use crate::logger;
use crate::ssh::{session, Connection};

/// Лимит тела запроса: 1 МБ (как в Electron-версии).
const MAX_BODY_BYTES: usize = 1024 * 1024;
/// Таймаут ожидания подтверждения команды пользователем: 5 минут.
const CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(300);
/// Таймаут выполнения команды на сервере.
const EXEC_TIMEOUT: Duration = Duration::from_secs(120);
/// Таймаут простоя сессии агента: 30 минут.
const SESSION_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Максимум агентов в статусе.
const MAX_REPORTED_AGENTS: usize = 20;
/// Максимум записей в буфере журнала на подключение.
const MAX_LOG_ITEMS: usize = 500;
/// Версии протокола, поддерживаемые текущим handshake-transport.
const MCP_PROTOCOL_VERSIONS: [&str; 3] = ["2025-03-26", "2025-06-18", "2025-11-25"];

// ── Типы статуса ─────────────────────────────────────────────────────────────

/// Состояние сервера (`McpServerState`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerState {
    #[default]
    Disabled,
    Starting,
    Running,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpAgent {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub last_seen: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub state: ServerState,
    pub port: u16,
    pub connected_agents: usize,
    pub agents: Vec<McpAgent>,
    pub require_confirmation: bool,
    pub allowed_server_ids: Vec<String>,
    pub pending_confirmations: Vec<ConfirmationRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationRequest {
    pub id: String,
    pub connection_id: String,
    pub server_name: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// Статус записи журнала (`McpLogStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStatus {
    Pending,
    Approved,
    Rejected,
    Running,
    Success,
    Failed,
    Cancelled,
}

/// Запись журнала — дискриминируемое объединение, как `McpLogItem`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LogItem {
    #[serde(rename_all = "camelCase")]
    Start {
        id: String,
        timestamp: u64,
        connection_id: String,
        action: String,
        run_id: String,
        status: LogStatus,
        tool_name: Option<String>,
        started_at: u64,
    },
    #[serde(rename_all = "camelCase")]
    ToolCall {
        id: String,
        timestamp: u64,
        connection_id: String,
        action: String,
        run_id: String,
        status: LogStatus,
        tool_name: Option<String>,
        command: Option<String>,
        args: Option<Value>,
        started_at: Option<u64>,
        error: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        id: String,
        timestamp: u64,
        connection_id: String,
        action: String,
        run_id: String,
        status: LogStatus,
        tool_name: Option<String>,
        command: Option<String>,
        started_at: Option<u64>,
        duration_ms: Option<u64>,
        stdout: Option<String>,
        stderr: Option<String>,
        exit_code: Option<i64>,
        error: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    End {
        id: String,
        timestamp: u64,
        connection_id: String,
        action: String,
        run_id: String,
        status: LogStatus,
        started_at: u64,
        duration_ms: u64,
    },
}

// ── Внутреннее состояние ─────────────────────────────────────────────────────

/// Активная сессия агента.
struct AgentSession {
    name: String,
    version: Option<String>,
    protocol_version: String,
    initialized: bool,
    last_activity: Instant,
    /// Активность в UI: при скрытой вкладке журнал не растёт.
    logs_visible: bool,
}

/// Ожидающее подтверждение команды.
struct PendingConfirmation {
    request: ConfirmationRequest,
    responder: oneshot::Sender<bool>,
}

/// Активный запуск инструмента (для отмены из UI).
#[derive(Default)]
struct ActiveRun {
    /// Признак отмены: команды проверяют его между шагами.
    cancelled: Arc<Mutex<bool>>,
}

/// Внутреннее состояние сервера.
#[derive(Default)]
struct Inner {
    state: ServerState,
    port: u16,
    /// Адрес фактического `bind`, чтобы смена адреса перезапускала сервер, а
    /// повторный `start` с неизменившимся конфигом был no-op.
    listen_address: String,
    error: Option<String>,
    sessions: HashMap<String, AgentSession>,
    confirmations: HashMap<String, PendingConfirmation>,
    runs: HashMap<String, ActiveRun>,
    logs: HashMap<String, Vec<LogItem>>,
}

/// Состояние MCP-сервера.
pub struct McpState {
    inner: Mutex<Inner>,
    /// Отправитель `axum::serve`, чтобы остановить сервер.
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    /// SSH-соединения для MCP-команд, по одному на сохранённый сервер.
    /// Mutex удерживается во время подключения, чтобы параллельные команды
    /// не создавали несколько SSH-сессий для одного сервера.
    helper_connections: Mutex<HashMap<String, Connection>>,
}

impl McpState {
    pub fn new() -> Self {
        McpState {
            inner: Mutex::new(Inner::default()),
            shutdown: Mutex::new(None),
            helper_connections: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for McpState {
    fn default() -> Self {
        McpState::new()
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

// ── Статус ───────────────────────────────────────────────────────────────────

/// Статус сервера для UI (`mcp-get-status`).
pub async fn status(state: &Arc<McpState>) -> McpStatus {
    let config = crate::config::load();
    let inner = state.inner.lock().await;

    let running = inner.state == ServerState::Running;
    let agents: Vec<McpAgent> = inner
        .sessions
        .iter()
        .map(|(id, session)| McpAgent {
            id: id.clone(),
            name: session.name.clone(),
            version: session.version.clone(),
            last_seen: now_millis().saturating_sub(session.last_activity.elapsed().as_millis() as u64),
        })
        .take(MAX_REPORTED_AGENTS)
        .collect();

    let pending_confirmations: Vec<ConfirmationRequest> = inner
        .confirmations
        .values()
        .map(|pending| pending.request.clone())
        .collect();

    let state_kind = if running {
        ServerState::Running
    } else if config.mcp_enabled {
        inner.state
    } else {
        ServerState::Disabled
    };

    McpStatus {
        enabled: config.mcp_enabled,
        running,
        state: state_kind,
        port: if inner.port > 0 { inner.port } else { config.mcp_port },
        connected_agents: agents.len(),
        agents,
        require_confirmation: config.mcp_require_confirmation,
        allowed_server_ids: config.mcp_allowed_server_ids.clone(),
        pending_confirmations,
        error: inner.error.clone(),
    }
}

/// Токен доступа из конфига.
pub fn token() -> String {
    crate::config::load().mcp_token
}

/// Сообщает UI об изменении статуса.
pub async fn broadcast_status(app: &AppHandle, state: &Arc<McpState>) {
    let status = status(state).await;
    let _ = app.emit("mcp-status-changed", status);
}

/// Добавляет запись в буфер журнала.
///
/// Вынесено из [`push_log`], чтобы правила буфера — видимость вкладки и
/// обрезка до [`MAX_LOG_ITEMS`] — можно было проверить без запуска приложения.
fn buffer_log(inner: &mut Inner, connection_id: &str, item: LogItem) {
    let visible = inner
        .sessions
        .values()
        .next()
        .map(|session| session.logs_visible)
        .unwrap_or(true);
    // Журнал растёт только пока вкладка MCP видна: иначе приложение,
    // запущенное в фоне с активным агентом, писало бы в память без нужды.
    if !visible {
        return;
    }
    let entries = inner.logs.entry(connection_id.to_owned()).or_default();
    entries.push(item);
    if entries.len() > MAX_LOG_ITEMS {
        let overflow = entries.len() - MAX_LOG_ITEMS;
        entries.drain(0..overflow);
    }
}

/// Добавляет запись в журнал и отправляет событие `mcp-log`.
pub async fn push_log(app: &AppHandle, state: &Arc<McpState>, connection_id: &str, item: LogItem) {
    {
        let mut inner = state.inner.lock().await;
        buffer_log(&mut inner, connection_id, item.clone());
    }
    let _ = app.emit("mcp-log", item);
}

/// Журнал по подключению (`mcp-get-logs`).
pub async fn logs(state: &Arc<McpState>, connection_id: &str) -> Vec<LogItem> {
    let inner = state.inner.lock().await;
    inner.logs.get(connection_id).cloned().unwrap_or_default()
}

/// Показывает/скрывает журнал (`mcp-set-logs-visible`).
pub async fn set_logs_visible(state: &Arc<McpState>, is_visible: bool) {
    let mut inner = state.inner.lock().await;
    for session in inner.sessions.values_mut() {
        session.logs_visible = is_visible;
    }
}

// ── Жизненный цикл сервера ───────────────────────────────────────────────────

/// Разбирает адрес прослушивания из конфига.
///
/// Конфиг нормализуется в [`crate::config`], поэтому сюда доходит одно из двух
/// значений. Ошибка разбора — тоже повод вернуть локальный адрес: лучше
/// ограничить доступ, чем поднять сервер в сети из-за опечатки в конфиге.
fn parse_listen_address(address: &str) -> Ipv4Addr {
    address.parse().unwrap_or_else(|_| {
        DEFAULT_MCP_LISTEN_ADDRESS.parse().expect("валидный адрес по умолчанию")
    })
}

/// Запускает сервер, если MCP включён в конфиге.
pub async fn start(app: &AppHandle, state: &Arc<McpState>) -> bool {
    let config = crate::config::load();
    if !config.mcp_enabled {
        set_state(state, ServerState::Disabled, None, 0).await;
        return false;
    }

    {
        let inner = state.inner.lock().await;
        if inner.state == ServerState::Running
            && inner.port == config.mcp_port
            && inner.listen_address == config.mcp_listen_address
        {
            return true;
        }
    }
    stop(app, state, false).await;

    set_state(state, ServerState::Starting, None, config.mcp_port).await;
    broadcast_status(app, state).await;

    if config.mcp_port == 0 {
        let message = crate::i18n::t("mcp.invalidPort", &[]);
        logger::error("MCP", &message);
        set_state(
            state,
            ServerState::Failed,
            Some(message),
            config.mcp_port,
        )
        .await;
        broadcast_status(app, state).await;
        return false;
    }

    let listen_ip = parse_listen_address(&config.mcp_listen_address);
    let address: SocketAddr = (listen_ip, config.mcp_port).into();
    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(err) => {
            let message = if err.kind() == std::io::ErrorKind::AddrInUse {
                crate::i18n::t("mcp.portInUse", &[("port", &config.mcp_port.to_string())])
            } else {
                crate::i18n::t("mcp.listenError", &[])
            };
            logger::error("MCP", &message);
            set_state(state, ServerState::Failed, Some(message), config.mcp_port).await;
            broadcast_status(app, state).await;
            return false;
        }
    };

    let app_handle = app.clone();
    let state_handle = state.clone();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    *state.shutdown.lock().await = Some(shutdown_tx);

    let router = axum::Router::new()
        .route("/mcp", axum::routing::post(handle_mcp).get(reject_sse_get).delete(reject_sse_get))
        .with_state(McpContext { app: app_handle, state: state_handle });

    let server = axum::serve(listener, router).with_graceful_shutdown(async {
        let _ = shutdown_rx.await;
    });

    logger::info("MCP", &format!("Server listening on http://{address}/mcp"));

    tauri::async_runtime::spawn(async move {
        if let Err(err) = server.await {
            logger::error("MCP", &format!("Server error: {err}"));
        }
    });

    set_state(state, ServerState::Running, None, config.mcp_port).await;
    state.inner.lock().await.listen_address = config.mcp_listen_address.clone();
    spawn_inactivity_watch(app, state);
    broadcast_status(app, state).await;
    true
}

/// Останавливает сервер.
pub async fn stop(app: &AppHandle, state: &Arc<McpState>, broadcast: bool) {
    set_state(state, ServerState::Stopping, None, 0).await;
    if broadcast {
        broadcast_status(app, state).await;
    }

    if let Some(shutdown) = state.shutdown.lock().await.take() {
        let _ = shutdown.send(());
    }

    {
        let mut inner = state.inner.lock().await;
        // Подтверждения снимаются: агент ждёт ответа, которого не будет.
        inner.confirmations.clear();
        inner.runs.clear();
        inner.sessions.clear();
    }

    let connections = std::mem::take(&mut *state.helper_connections.lock().await);
    for (_, connection) in connections {
        connection.disconnect("MCP server stopped").await;
    }

    set_state(state, ServerState::Disabled, None, 0).await;
    if broadcast {
        broadcast_status(app, state).await;
    }
}

/// Приводит состояние сервера в соответствие с конфигом.
pub async fn sync_state(app: &AppHandle, state: &Arc<McpState>) {
    if crate::config::load().mcp_enabled {
        start(app, state).await;
    } else {
        stop(app, state, true).await;
    }
}

async fn set_state(state: &Arc<McpState>, server_state: ServerState, error: Option<String>, port: u16) {
    let mut inner = state.inner.lock().await;
    inner.state = server_state;
    inner.error = error;
    if port > 0 {
        inner.port = port;
    }
}

/// Таймер простоя: забывает агентов, которые не обращались дольше получаса.
fn spawn_inactivity_watch(app: &AppHandle, state: &Arc<McpState>) {
    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let expired = {
                let mut inner = state.inner.lock().await;
                let before = inner.sessions.len();
                inner
                    .sessions
                    .retain(|_, session| session.last_activity.elapsed() < SESSION_INACTIVITY_TIMEOUT);
                inner.sessions.len() != before
            };
            if expired {
                broadcast_status(&app, &state).await;
            }
        }
    });
}

/// Генерация нового токена (`mcp-regenerate-token`).
///
/// Старый токен перестаёт работать немедленно: агент, державший его, получит
/// 401 и переподключится с новым токеном.
pub async fn regenerate_token() {
    let mut config = crate::config::load();
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    config.mcp_token = hex::encode(bytes);
    let _ = crate::config::save_async(config).await;
}

// ── HTTP-обработчик ──────────────────────────────────────────────────────────

#[derive(Clone)]
struct McpContext {
    app: AppHandle,
    state: Arc<McpState>,
}

async fn handle_mcp(
    axum::extract::State(context): axum::extract::State<McpContext>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    if !is_valid_origin(&headers) {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(json!({ "error": "Forbidden: invalid Origin" })),
        )
            .into_response();
    }

    if body.len() > MAX_BODY_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            axum::Json(json!({ "error": "Payload Too Large: HTTP body exceeded 1 MB limit" })),
        )
            .into_response();
    }

    if !is_valid_bearer(&headers, &token()) {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({ "error": "Unauthorized: Invalid MCP token" })),
        )
            .into_response();
    }

    if !has_json_content_type(&headers) || !accepts_json_and_event_stream(&headers) {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(json!({ "error": "POST /mcp requires application/json and Accept: application/json, text/event-stream" })),
        )
            .into_response();
    }

    let session_id = headers
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_owned());

    if let Some(session_id) = session_id.as_deref() {
        let Some(negotiated_version) = touch_session(&context.state, session_id).await else {
            return (
                StatusCode::NOT_FOUND,
                axum::Json(json!({
                    "jsonrpc": "2.0",
                    "error": { "code": -32001, "message": "Session not found" },
                    "id": Value::Null
                })),
            )
                .into_response();
        };
        if let Some(version_header) = headers.get("mcp-protocol-version") {
            let requested_version = version_header.to_str().unwrap_or_default();
            if !MCP_PROTOCOL_VERSIONS.contains(&requested_version)
                || requested_version != negotiated_version
            {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(json!({ "error": "Invalid or mismatched MCP-Protocol-Version" })),
                )
                    .into_response();
            }
        }
    }

    let Ok(request) = serde_json::from_slice::<Value>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(error_response(Value::Null, -32700, "Parse error")),
        )
            .into_response();
    };

    let valid_id = request.get("id").is_none_or(|id| {
        id.is_null() || id.is_string() || id.is_number()
    });
    let valid_params = request.get("params").is_none_or(|params| params.is_object() || params.is_array());
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || request.get("method").and_then(Value::as_str).is_none()
        || !valid_id
        || !valid_params
    {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(error_response(Value::Null, -32600, "Invalid Request")),
        )
            .into_response();
    }

    let method = request.get("method").and_then(Value::as_str).unwrap_or_default().to_owned();
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let params = request.get("params").cloned().unwrap_or(Value::Null);
    let is_notification = request.get("id").is_none();

    if method == "initialize" {
        if is_notification || session_id.is_some() {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(error_response(id, -32600, "Initialize must be a request without an existing session")),
            )
                .into_response();
        }
        let new_session = crate::paths::new_uuid();
        let requested_version = params
            .get("protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        // Ответ должен содержать реально согласованную версию, а не безусловно
        // отражать значение клиента. При неизвестной версии предлагаем
        // последнюю версию handshake, которую умеет этот сервер.
        let protocol_version = if MCP_PROTOCOL_VERSIONS.contains(&requested_version.as_str()) {
            requested_version
        } else {
            "2025-11-25".to_owned()
        };
        let client_info = params.get("clientInfo");
        register_session(
            &context.state,
            &new_session,
            client_info.and_then(|info| info.get("name")).and_then(Value::as_str).unwrap_or("agent").to_owned(),
            client_info
                .and_then(|info| info.get("version"))
                .and_then(Value::as_str)
                .map(|value| value.to_owned()),
            protocol_version.clone(),
        )
        .await;

        let response = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": protocol_version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "yassh-client", "version": env!("CARGO_PKG_VERSION") }
            }
        });
        return with_session_header(
            (StatusCode::OK, axum::Json(response)).into_response(),
            &new_session,
        );
    }

    if session_id.is_none() && method != "ping" {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(error_response(id, -32000, "Bad Request: Mcp-Session-Id header is required")),
        )
            .into_response();
    }

    if is_notification {
        // Notifications (including notifications/initialized) have no JSON-RPC
        // response and must never trigger a tool execution.
        if method == "notifications/initialized" {
            if let Some(session_id) = session_id.as_deref() {
                mark_session_initialized(&context.state, session_id).await;
            }
        }
        return StatusCode::ACCEPTED.into_response();
    }

    if method != "ping" {
        if let Some(session_id) = session_id.as_deref() {
            if !is_session_initialized(&context.state, session_id).await {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(error_response(id, -32002, "Session initialization is incomplete")),
                )
                    .into_response();
            }
        }
    }

    if method == "tools/list" {
        return (
            StatusCode::OK,
            axum::Json(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "tools": tools_list() }
            })),
        )
            .into_response();
    }

    if method == "tools/call" {
        let name = params.get("name").and_then(Value::as_str).unwrap_or_default().to_owned();
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
        let (text, is_error) = call_tool(&context.app, &context.state, &name, &arguments, session_id).await;
        return (
            StatusCode::OK,
            axum::Json(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "isError": is_error, "content": [{ "type": "text", "text": text }] }
            })),
        )
            .into_response();
    }

    if method == "ping" {
        return (StatusCode::OK, axum::Json(json!({ "jsonrpc": "2.0", "id": id, "result": {} }))).into_response();
    }

    (StatusCode::OK, axum::Json(error_response(id, -32601, "Method not found"))).into_response()
}

/// GET is the optional SSE stream in Streamable HTTP. This server has no
/// server-to-client stream and explicitly advertises that with HTTP 405.
async fn reject_sse_get(headers: axum::http::HeaderMap) -> axum::http::StatusCode {
    if !is_valid_origin(&headers) {
        return axum::http::StatusCode::FORBIDDEN;
    }
    if !is_valid_bearer(&headers, &token()) {
        return axum::http::StatusCode::UNAUTHORIZED;
    }
    axum::http::StatusCode::METHOD_NOT_ALLOWED
}

fn is_valid_origin(headers: &axum::http::HeaderMap) -> bool {
    let Some(origin) = headers.get(axum::http::header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else { return false };
    let Ok(uri) = origin.parse::<axum::http::Uri>() else { return false };
    if !matches!(uri.scheme_str(), Some("http") | Some("https")) {
        return false;
    }
    let Some(host) = uri.host() else { return false };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().is_ok_and(|address| address.is_loopback())
}

fn has_json_content_type(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|media_type| media_type.trim().eq_ignore_ascii_case("application/json"))
}

fn accepts_json_and_event_stream(headers: &axum::http::HeaderMap) -> bool {
    let accept = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let mut accepts_json = false;
    let mut accepts_event_stream = false;
    for media_type in accept.split(',').filter_map(|part| part.split(';').next()) {
        match media_type.trim().to_ascii_lowercase().as_str() {
            "application/json" => accepts_json = true,
            "text/event-stream" => accepts_event_stream = true,
            _ => {}
        }
    }
    accepts_json && accepts_event_stream
}

fn with_session_header(response: axum::response::Response, session_id: &str) -> axum::response::Response {
    use axum::http::header::HeaderValue;
    let mut response = response;
    if let Ok(value) = HeaderValue::from_str(session_id) {
        response.headers_mut().insert("mcp-session-id", value);
    }
    response
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Сравнение токена за постоянное время (аналог `crypto.timingSafeEqual`).
fn is_valid_bearer(headers: &axum::http::HeaderMap, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let Some(value) = headers.get(axum::http::header::AUTHORIZATION).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let Some(token) = value.strip_prefix("Bearer ") else { return false };

    let mut difference = token.trim().len() ^ expected.len();
    for (left, right) in token.trim().bytes().zip(expected.bytes()) {
        difference |= usize::from(left ^ right);
    }
    difference == 0
}

async fn touch_session(state: &Arc<McpState>, session_id: &str) -> Option<String> {
    let mut inner = state.inner.lock().await;
    match inner.sessions.get_mut(session_id) {
        Some(session) => {
            session.last_activity = Instant::now();
            Some(session.protocol_version.clone())
        }
        None => None,
    }
}

async fn mark_session_initialized(state: &Arc<McpState>, session_id: &str) {
    if let Some(session) = state.inner.lock().await.sessions.get_mut(session_id) {
        session.initialized = true;
    }
}

async fn is_session_initialized(state: &Arc<McpState>, session_id: &str) -> bool {
    state
        .inner
        .lock()
        .await
        .sessions
        .get(session_id)
        .is_some_and(|session| session.initialized)
}

async fn register_session(
    state: &Arc<McpState>,
    session_id: &str,
    name: String,
    version: Option<String>,
    protocol_version: String,
) {
    let mut inner = state.inner.lock().await;
    inner.sessions.insert(
        session_id.to_owned(),
        AgentSession {
            name,
            version,
            protocol_version,
            initialized: false,
            last_activity: Instant::now(),
            logs_visible: true,
        },
    );
}

// ── Инструменты ──────────────────────────────────────────────────────────────

fn tools_list() -> Vec<Value> {
    vec![
        json!({
            "name": "list_connections",
            "description": "Get list of saved SSH connections enabled for MCP access.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "execute_command",
            "description": "Execute a bash/shell command on an allowed SSH connection and return stdout, stderr, and exit code. If multiple connections are open, connection_id is strictly required.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connection_id": {
                        "type": "string",
                        "description": "The SSH connection ID (required if multiple connections are open for MCP access)."
                    },
                    "command": {
                        "type": "string",
                        "minLength": 1,
                        "description": "The shell command to execute on the SSH server."
                    }
                },
                "required": ["command"]
            }
        }),
    ]
}

/// Вызов инструмента: возвращает `(text, isError)`.
async fn call_tool(
    app: &AppHandle,
    state: &Arc<McpState>,
    name: &str,
    arguments: &Value,
    session_id: Option<String>,
) -> (String, bool) {
    match name {
        "list_connections" => list_connections(),
        "execute_command" => {
            execute_command(app, state, arguments, session_id.unwrap_or_default()).await
        }
        other => (format!("Unknown tool: {other}"), true),
    }
}

/// Список разрешённых подключений.
fn list_connections() -> (String, bool) {
    let config: AppConfig = crate::config::load();
    if !config.mcp_enabled {
        return ("MCP server is disabled.".to_owned(), true);
    }

    let allowed: Vec<&String> = config.mcp_allowed_server_ids.iter().collect();
    let connections: Vec<Value> = config
        .favorites
        .iter()
        .filter(|favorite| {
            favorite
                .id
                .as_ref()
                .map(|id| allowed.iter().any(|value| *value == id))
                .unwrap_or(false)
        })
        .map(|favorite| {
            json!({
                "id": favorite.id,
                "name": if favorite.name.is_empty() { &favorite.host } else { &favorite.name },
                "host": favorite.host,
                "user": favorite.user,
                "port": favorite.effective_port(),
                "osPrettyName": favorite.os_pretty_name
            })
        })
        .collect();

    (serde_json::to_string_pretty(&json!({ "connections": connections })).unwrap_or_default(), false)
}

/// Выполнение команды на разрешённом подключении.
async fn execute_command(
    app: &AppHandle,
    state: &Arc<McpState>,
    arguments: &Value,
    session_id: String,
) -> (String, bool) {
    let config = crate::config::load();
    let command = arguments
        .get("command")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_owned())
        .unwrap_or_default();

    if command.is_empty() {
        return ("Command argument is required".to_owned(), true);
    }
    if !config.mcp_enabled {
        return ("MCP server is disabled.".to_owned(), true);
    }

    let requested_id = arguments
        .get("connection_id")
        .and_then(Value::as_str)
        .map(|value| value.to_owned());

    let allowed: Vec<&crate::config::SshConfig> = config
        .favorites
        .iter()
        .filter(|favorite| {
            favorite
                .id
                .as_ref()
                .map(|id| config.mcp_allowed_server_ids.contains(id))
                .unwrap_or(false)
        })
        .collect();

    // Несколько открытых подключений ⇒ connection_id обязателен, иначе агент
    // выполнит команду там, где не ожидал.
    let target = match (&requested_id, allowed.len()) {
        (Some(id), _) => allowed.iter().find(|favorite| favorite.id.as_deref() == Some(id.as_str())).copied(),
        (None, 1) => Some(allowed[0]),
        (None, 0) => return ("No SSH connections are enabled for MCP access.".to_owned(), true),
        (None, _) => return ("connection_id is required when multiple connections are open.".to_owned(), true),
    };

    let Some(target) = target else {
        return (format!("Connection not found: {}", requested_id.unwrap_or_default()), true);
    };
    let Some(connection_id) = target.id.clone() else {
        return ("Connection has no id".to_owned(), true);
    };

    let run_id = crate::paths::new_uuid();
    let started_at = now_millis();
    let cancelled = Arc::new(Mutex::new(false));
    state.inner.lock().await.runs.insert(
        run_id.clone(),
        ActiveRun { cancelled: cancelled.clone() },
    );

    push_log(
        app,
        state,
        &connection_id,
        LogItem::Start {
            id: crate::paths::new_uuid(),
            timestamp: started_at,
            connection_id: connection_id.clone(),
            action: "execute_command".to_owned(),
            run_id: run_id.clone(),
            status: LogStatus::Pending,
            tool_name: Some("execute_command".to_owned()),
            started_at,
        },
    )
    .await;

    push_log(
        app,
        state,
        &connection_id,
        LogItem::ToolCall {
            id: crate::paths::new_uuid(),
            timestamp: now_millis(),
            connection_id: connection_id.clone(),
            action: "execute_command".to_owned(),
            run_id: run_id.clone(),
            status: LogStatus::Pending,
            tool_name: Some("execute_command".to_owned()),
            command: Some(command.clone()),
            args: Some(arguments.clone()),
            started_at: Some(started_at),
            error: None,
        },
    )
    .await;

    // Подтверждение пользователя.
    if config.mcp_require_confirmation {
        let approved = request_confirmation(app, state, &connection_id, &target.name, &command, &session_id).await;
        if !approved {
            finish_run(
                app,
                state,
                &run_id,
                &connection_id,
                LogStatus::Rejected,
                Some("Rejected by user".to_owned()),
                started_at,
            )
            .await;
            return ("Rejected by user".to_owned(), true);
        }
    }

    if *cancelled.lock().await {
        finish_run(
            app,
            state,
            &run_id,
            &connection_id,
            LogStatus::Cancelled,
            Some("Execution cancelled by user".to_owned()),
            started_at,
        )
        .await;
        return ("Execution cancelled by user".to_owned(), true);
    }

    let outcome = run_command(state, target, &command, cancelled.clone()).await;
    let duration_ms = now_millis().saturating_sub(started_at);

    state.inner.lock().await.runs.remove(&run_id);

    match outcome {
        Ok(outcome) => {
            push_log(
                app,
                state,
                &connection_id,
                LogItem::ToolResult {
                    id: crate::paths::new_uuid(),
                    timestamp: now_millis(),
                    connection_id: connection_id.clone(),
                    action: "execute_command".to_owned(),
                    run_id: run_id.clone(),
                    status: LogStatus::Success,
                    tool_name: Some("execute_command".to_owned()),
                    command: Some(command.clone()),
                    started_at: Some(started_at),
                    duration_ms: Some(duration_ms),
                    stdout: Some(outcome.stdout.clone()),
                    stderr: Some(outcome.stderr.clone()),
                    exit_code: outcome.code,
                    error: None,
                },
            )
            .await;

            let text = serde_json::to_string_pretty(&json!({
                "stdout": outcome.stdout,
                "stderr": outcome.stderr,
                "exitCode": outcome.code
            }))
            .unwrap_or_default();
            push_end(app, state, &run_id, &connection_id, LogStatus::Success, started_at).await;
            (text, false)
        }
        Err(message) => {
            finish_run(app, state, &run_id, &connection_id, LogStatus::Failed, Some(message.clone()), started_at).await;
            (message, true)
        }
    }
}

/// Подключается к серверу и выполняет команду с таймаутом.
async fn run_command(
    state: &Arc<McpState>,
    target: &crate::config::SshConfig,
    command: &str,
    cancelled: Arc<Mutex<bool>>,
) -> Result<session::ExecOutcome, String> {
    let connection_id = target.id.as_deref().ok_or_else(|| "Connection has no id".to_owned())?;
    let connection = {
        let mut connections = state.helper_connections.lock().await;
        let existing = connections.get(connection_id).cloned();
        match existing {
            Some(connection) if !connection.is_closed_async().await => connection,
            _ => {
                connections.remove(connection_id);
                let connection = crate::ssh::registry::open_helper_connection(target).await?;
                connections.insert(connection_id.to_owned(), connection.clone());
                connection
            }
        }
    };

    let future = session::exec(&connection, command);
    let result = match tokio::time::timeout(EXEC_TIMEOUT, future).await {
        Ok(Ok(_)) if *cancelled.lock().await => Err(crate::i18n::t("mcp.executionCancelled", &[])),
        Ok(Ok(outcome)) => Ok(outcome),
        Ok(Err(err)) => Err(err.localized()),
        Err(_) => Err(crate::i18n::t("mcp.timeoutError", &[])),
    };
    if connection.is_closed_async().await {
        let mut connections = state.helper_connections.lock().await;
        let stored_connection = connections.get(connection_id).cloned();
        if let Some(stored_connection) = stored_connection {
            if stored_connection.is_closed_async().await {
                connections.remove(connection_id);
            }
        }
    }
    result
}

/// Просит пользователя подтвердить команду.
async fn request_confirmation(
    app: &AppHandle,
    state: &Arc<McpState>,
    connection_id: &str,
    server_name: &str,
    command: &str,
    session_id: &str,
) -> bool {
    let request = ConfirmationRequest {
        id: crate::paths::new_uuid(),
        connection_id: connection_id.to_owned(),
        server_name: server_name.to_owned(),
        command: command.to_owned(),
        session_id: if session_id.is_empty() { None } else { Some(session_id.to_owned()) },
    };

    let (responder, receiver) = oneshot::channel();
    let id = request.id.clone();
    state
        .inner
        .lock()
        .await
        .confirmations
        .insert(id.clone(), PendingConfirmation { request: request.clone(), responder });

    let _ = app.emit("mcp-request-confirmation", &request);
    broadcast_status(app, state).await;

    match tokio::time::timeout(CONFIRMATION_TIMEOUT, receiver).await {
        Ok(Ok(approved)) => approved,
        // Пользователь не ответил за 5 минут либо сессия закрылась.
        Ok(Err(_)) | Err(_) => {
            state.inner.lock().await.confirmations.remove(&id);
            let _ = app.emit("mcp-request-confirmation-resolved", json!({ "id": id, "approved": false }));
            false
        }
    }
}

/// Ответ пользователя на подтверждение (`mcp-confirm-command`).
pub async fn confirm_command(
    app: &AppHandle,
    state: &Arc<McpState>,
    id: &str,
    approved: bool,
) -> bool {
    let pending = state.inner.lock().await.confirmations.remove(id);
    let Some(pending) = pending else { return false };

    broadcast_status(app, state).await;
    pending.responder.send(approved).is_ok()
}

/// Отмена запуска (`mcp-cancel-run`).
pub async fn cancel_run(state: &Arc<McpState>, run_id: &str) -> bool {
    let run = state.inner.lock().await.runs.remove(run_id);
    match run {
        Some(run) => {
            *run.cancelled.lock().await = true;
            true
        }
        None => false,
    }
}

/// Отзывает доступ к серверу (сервер удалён из конфига).
pub async fn revoke_by_server_id(state: &Arc<McpState>, server_id: &str) {
    {
        let mut inner = state.inner.lock().await;
        let ids: Vec<String> = inner
            .confirmations
            .iter()
            .filter(|(_, pending)| pending.request.connection_id == server_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(pending) = inner.confirmations.remove(&id) {
                let _ = pending.responder.send(false);
            }
        }
    }

    if let Some(connection) = state.helper_connections.lock().await.remove(server_id) {
        connection.disconnect("MCP access revoked").await;
    }
}

async fn finish_run(
    app: &AppHandle,
    state: &Arc<McpState>,
    run_id: &str,
    connection_id: &str,
    status: LogStatus,
    error: Option<String>,
    started_at: u64,
) {
    push_log(
        app,
        state,
        connection_id,
        LogItem::ToolResult {
            id: crate::paths::new_uuid(),
            timestamp: now_millis(),
            connection_id: connection_id.to_owned(),
            action: "execute_command".to_owned(),
            run_id: run_id.to_owned(),
            status,
            tool_name: Some("execute_command".to_owned()),
            command: None,
            started_at: Some(started_at),
            duration_ms: Some(now_millis().saturating_sub(started_at)),
            stdout: None,
            stderr: None,
            exit_code: None,
            error,
        },
    )
    .await;
    push_end(app, state, run_id, connection_id, status, started_at).await;
}

async fn push_end(
    app: &AppHandle,
    state: &Arc<McpState>,
    run_id: &str,
    connection_id: &str,
    status: LogStatus,
    started_at: u64,
) {
    push_log(
        app,
        state,
        connection_id,
        LogItem::End {
            id: crate::paths::new_uuid(),
            timestamp: now_millis(),
            connection_id: connection_id.to_owned(),
            action: "run".to_owned(),
            run_id: run_id.to_owned(),
            status,
            started_at,
            duration_ms: now_millis().saturating_sub(started_at),
        },
    )
    .await;
}

/// Открывает сервер для MCP (`mcp-open-server`).
pub async fn open_server(app: &AppHandle, state: &Arc<McpState>, server_id: &str) -> bool {
    let mut config = crate::config::load();
    if !config.mcp_allowed_server_ids.iter().any(|value| value == server_id) {
        config.mcp_allowed_server_ids.push(server_id.to_owned());
        let _ = crate::config::save_async(config).await;
    }
    broadcast_status(app, state).await;
    true
}

/// Закрывает сервер для MCP (`mcp-close-server`).
pub async fn close_server(app: &AppHandle, state: &Arc<McpState>, server_id: &str) -> bool {
    let mut config = crate::config::load();
    config.mcp_allowed_server_ids.retain(|value| value != server_id);
    let _ = crate::config::save_async(config).await;
    revoke_by_server_id(state, server_id).await;
    broadcast_status(app, state).await;
    true
}

/// Проверка авторизации для тестов.
#[cfg(test)]
#[path = "tests/mcp.rs"]
mod tests;
