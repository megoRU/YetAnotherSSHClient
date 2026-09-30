//! Телеметрия — порт `electron/src/telemetry.ts`.
//!
//! Отправляется один анонимный отчёт при старте, строго после показа окна:
//! сеть не должна конкурировать с первым рендером. Любая ошибка молча
//! игнорируется — телеметрия никогда не влияет на работу приложения.

use serde::Serialize;

use crate::config::AppConfig;
use crate::logger;
use crate::paths;

/// Куда уходит отчёт.
const ENDPOINT: &str = "https://api.megoru.ru/api/telemetry";

#[derive(Serialize)]
struct TelemetryPayload<'a> {
    client_id: &'a str,
    version: &'a str,
    platform: &'a str,
    arch: &'a str,
    favorite_count: usize,
    mcp_enabled: bool,
    theme: &'a str,
    language: &'a str,
}

/// Отправляет телеметрию в фоне.
pub async fn send() {
    let config: AppConfig = crate::config::load();
    if config.client_id.is_empty() {
        return;
    }

    let payload = TelemetryPayload {
        client_id: &config.client_id,
        version: env!("CARGO_PKG_VERSION"),
        platform: paths::platform_id(),
        arch: std::env::consts::ARCH,
        favorite_count: config.favorites.len(),
        mcp_enabled: config.mcp_enabled,
        theme: &config.theme,
        language: &config.language,
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            logger::debug("Telemetry", &format!("Client build failed: {err}"));
            return;
        }
    };

    match client.post(ENDPOINT).json(&payload).send().await {
        Ok(response) => logger::debug("Telemetry", &format!("Sent, status {}", response.status())),
        Err(err) => logger::debug("Telemetry", &format!("Send failed: {err}")),
    }
}

#[cfg(test)]
#[path = "tests/telemetry.rs"]
mod tests;
