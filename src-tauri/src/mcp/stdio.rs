//! Подключение локальных MCP-клиентов к HTTP-серверу приложения через stdin/stdout.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tokio::task::JoinSet;
use tokio::time::{Instant, sleep};

use super::{error_response, initialize_result, protocol_version, success_response, tools_list};

const SESSION_HEADER: &str = "mcp-session-id";
const START_TIMEOUT: Duration = Duration::from_secs(20);
const SERVER_UNAVAILABLE: &str =
    "Could not connect to YASSH Client. Open the app and check the MCP settings.";

pub(super) fn executable() -> std::io::Result<PathBuf> {
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
    {
        return Ok(path);
    }
    std::env::current_exe()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    mcp_enabled: bool,
    mcp_port: u16,
    mcp_token: String,
}

impl Settings {
    fn read() -> Result<Self, &'static str> {
        let settings = crate::paths::config_path()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|raw| serde_json::from_slice::<Self>(&raw).ok())
            .ok_or(SERVER_UNAVAILABLE)?;
        if !settings.mcp_enabled || settings.mcp_token.is_empty() {
            return Err("Enable MCP in YASSH Client settings.");
        }
        Ok(settings)
    }
}

struct Bridge {
    client: Client,
    initialize: Value,
    session: Mutex<Option<String>>,
}

impl Bridge {
    async fn post(
        &self,
        settings: &Settings,
        session: Option<&str>,
        message: &Value,
    ) -> reqwest::Result<Response> {
        let mut request = self
            .client
            .post(format!("http://127.0.0.1:{}/mcp", settings.mcp_port))
            .header("accept", "application/json, text/event-stream")
            .bearer_auth(&settings.mcp_token)
            .json(message);
        if let Some(session) = session {
            request = request.header(SESSION_HEADER, session);
        } else {
            request = request.timeout(Duration::from_secs(2));
        }
        request.send().await
    }

    async fn session(
        &self,
        settings: &Settings,
        expired: Option<&str>,
    ) -> Result<String, &'static str> {
        let mut cached = self.session.lock().await;
        if let Some(session) = cached
            .as_deref()
            .filter(|session| Some(*session) != expired)
        {
            return Ok(session.to_owned());
        }
        *cached = None;
        let mut result = self.post(settings, None, &self.initialize).await;
        if result.as_ref().is_err_and(reqwest::Error::is_connect) {
            launch_app().map_err(|_| SERVER_UNAVAILABLE)?;
            let deadline = Instant::now() + START_TIMEOUT;
            while result.as_ref().is_err_and(reqwest::Error::is_connect)
                && Instant::now() < deadline
            {
                sleep(Duration::from_millis(250)).await;
                result = self.post(settings, None, &self.initialize).await;
            }
        }
        let response = result.map_err(|_| SERVER_UNAVAILABLE)?;
        let session = response
            .headers()
            .get(SESSION_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|_| response.status() == StatusCode::OK)
            .ok_or(SERVER_UNAVAILABLE)?
            .to_owned();
        let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        let response = tokio::time::timeout(
            Duration::from_secs(2),
            self.post(settings, Some(&session), &initialized),
        )
        .await
        .map_err(|_| SERVER_UNAVAILABLE)?
        .map_err(|_| SERVER_UNAVAILABLE)?;
        if response.status() != StatusCode::ACCEPTED {
            return Err(SERVER_UNAVAILABLE);
        }
        *cached = Some(session.clone());
        Ok(session)
    }

    async fn tool_call(&self, message: &Value) -> Result<Value, &'static str> {
        let settings = Settings::read()?;
        let session = self.session(&settings, None).await?;
        let result = self.post(&settings, Some(&session), message).await;
        // HTTP 404 означает, что сессия устарела и сервер ещё не вызвал инструмент.
        let response = if result
            .as_ref()
            .is_ok_and(|response| response.status() == StatusCode::NOT_FOUND)
            || result.as_ref().is_err_and(reqwest::Error::is_connect)
        {
            let renewed = self.session(&settings, Some(&session)).await?;
            self.post(&settings, Some(&renewed), message).await
        } else {
            result
        }
        .map_err(|_| SERVER_UNAVAILABLE)?;
        if !response.status().is_success() {
            return Err(SERVER_UNAVAILABLE);
        }
        response.json().await.map_err(|_| SERVER_UNAVAILABLE)
    }
}

fn launch_app() -> std::io::Result<()> {
    let mut command = Command::new(executable()?);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000008); // DETACHED_PROCESS
    }
    let mut child = command.spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// В этом режиме stdout зарезервирован для ответов JSON-RPC.
#[tokio::main(flavor = "current_thread")]
pub async fn run() {
    let Ok(client) = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .build()
    else {
        return;
    };
    let mut bridge = None;
    let mut ready = false;
    let mut input = BufReader::new(tokio::io::stdin()).lines();
    let mut output = tokio::io::stdout();
    let mut pending = JoinSet::new();

    loop {
        let reply = tokio::select! {
            line = input.next_line() => {
                let Ok(Some(line)) = line else { break };
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    if write_reply(&mut output, error_response(Value::Null, -32700, "Parse error")).await.is_err() { break }
                    continue;
                };
                let method = message.get("method").and_then(Value::as_str);
                let valid_id = message.get("id").is_none_or(|id| id.is_null() || id.is_string() || id.is_number());
                let valid_params = message.get("params").is_none_or(|params| params.is_object() || params.is_array());
                if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
                    || method.is_none() || !valid_id || !valid_params
                {
                    if write_reply(&mut output, error_response(Value::Null, -32600, "Invalid Request")).await.is_err() { break }
                    continue;
                }
                if method == Some("notifications/initialized") && message.get("id").is_none() {
                    ready = bridge.is_some();
                }
                let Some(id) = message.get("id").cloned() else { continue };
                match method {
                    Some("initialize") if bridge.is_none() => {
                        let version = protocol_version(&message["params"]);
                        bridge = Some(Arc::new(Bridge { client: client.clone(), initialize: message, session: Mutex::new(None) }));
                        success_response(id, initialize_result(version))
                    }
                    Some("initialize") => error_response(id, -32600, "Session already initialized"),
                    Some("ping") => success_response(id, json!({})),
                    _ if !ready => error_response(id, -32002, "Session initialization is incomplete"),
                    Some("tools/list") => success_response(id, json!({ "tools": tools_list() })),
                    Some("tools/call") => {
                        let Some(bridge) = bridge.clone() else { continue };
                        pending.spawn(async move {
                            bridge.tool_call(&message).await.unwrap_or_else(|error| {
                                success_response(id, json!({ "isError": true, "content": [{ "type": "text", "text": error }] }))
                            })
                        });
                        continue;
                    }
                    _ => error_response(id, -32601, "Method not found"),
                }
            }
            Some(result) = pending.join_next(), if !pending.is_empty() => {
                let Ok(reply) = result else { continue };
                reply
            }
        };
        if write_reply(&mut output, reply).await.is_err() {
            break;
        }
    }
}

async fn write_reply(output: &mut tokio::io::Stdout, reply: Value) -> std::io::Result<()> {
    let mut line = reply.to_string();
    line.push('\n');
    output.write_all(line.as_bytes()).await?;
    output.flush().await
}
