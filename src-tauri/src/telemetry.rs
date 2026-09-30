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
mod tests {
    use super::*;

    fn payload() -> serde_json::Value {
        serde_json::to_value(TelemetryPayload {
            client_id: "client-1",
            version: "4.0.0",
            platform: "windows",
            arch: "x86_64",
            favorite_count: 2,
            mcp_enabled: true,
            theme: "dark",
            language: "ru",
        })
        .expect("json")
    }

    #[test]
    fn отчёт_содержит_только_обезличенные_поля() {
        let value = payload();

        assert_eq!(value["client_id"], "client-1");
        assert_eq!(value["version"], "4.0.0");
        assert_eq!(value["platform"], "windows");
        assert_eq!(value["arch"], "x86_64");
        assert_eq!(value["favorite_count"], 2);
        assert_eq!(value["mcp_enabled"], true);
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["language"], "ru");
        assert_eq!(
            value.as_object().expect("объект").len(),
            8,
            "в отчёте появилось лишнее поле: {value}"
        );
    }

    #[test]
    fn отчёт_не_уносит_секреты() {
        // Хосты, имена серверов, логины и ключи наружу уходить не должны:
        // проверяем по именам полей, а не по значениям.
        let text = payload().to_string();
        for forbidden in ["host", "user", "name", "password", "passphrase", "privateKey", "token"] {
            assert!(
                !text.contains(forbidden),
                "в телеметрию попало поле {forbidden}: {text}"
            );
        }
    }
}
