//! Телеметрия — порт `electron/src/telemetry.ts`.
//!
//! Отправляется один анонимный отчёт при старте, строго после показа окна:
//! сеть не должна конкурировать с первым рендером. Любая ошибка молча
//! игнорируется — телеметрия никогда не влияет на работу приложения.
//!
//! Отчёт состоит из трёх полей — идентификатор установки, версия и ОС. Этого
//! достаточно, чтобы знать число активных установок и распределение по
//! платформам. Настройки пользователя (тема, язык, число избранного,
//! включённый MCP), характеристики машины (архитектура) и тем более данные
//! подключений наружу не уходят: статистика не стоит утечки того, как человек
//! работает.
//!
//! ## Имена полей — camelCase
//!
//! Принимающая сторона ждёт `clientId`, `version`, `os`; отправка `client_id`
//! приводит к 500 на стороне сервера, и отчёт молча теряется. Поэтому у
//! структуры `#[serde(rename_all = "camelCase")]`, а тест фиксирует именно
//! итоговые имена полей в JSON, а не имена полей в Rust.

use serde::Serialize;

use crate::config::AppConfig;
use crate::logger;

/// Куда уходит отчёт.
const ENDPOINT: &str = "https://api.megoru.ru/api/telemetry";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryPayload<'a> {
    client_id: &'a str,
    version: &'a str,
    os: &'a str,
}

/// Имя ОС для телеметрии: `windows` | `macos` | `linux`.
///
/// Отдельная функция, а не [`paths::platform_id`]: там значения в терминах
/// Node.js (`win32`, `darwin`), и фронтенд использует их для выбора поведения
/// горячих клавиш. В отчёте нужны человеческие имена, поэтому `win32` →
/// `windows`, `darwin` → `macos`.
fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    }
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
        os: os_name(),
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
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                logger::debug("Telemetry", &format!("Sent, status {status}"));
            } else {
                // Ответ без 2xx — отчёт не принят. Раньше это попадало в
                // лог как успешная отправка, и по логу нельзя было понять,
                // что данные до сервера не дошли.
                logger::warn("Telemetry", &format!("Rejected by server, status {status}"));
            }
        }
        Err(err) => logger::debug("Telemetry", &format!("Send failed: {err}")),
    }
}

#[cfg(test)]
#[path = "tests/telemetry.rs"]
mod tests;
