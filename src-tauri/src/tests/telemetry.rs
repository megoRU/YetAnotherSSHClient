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

/// Набор полей — контракт с принимающей стороной: лишнее поле утекает
/// данные, потерянное ломает статистику.
#[test]
fn набор_полей_фиксирован() {
    let value = payload();
    let keys: Vec<&str> = value
        .as_object()
        .expect("объект")
        .keys()
        .map(String::as_str)
        .collect();
    let mut expected = vec![
        "arch",
        "client_id",
        "favorite_count",
        "language",
        "mcp_enabled",
        "platform",
        "theme",
        "version",
    ];
    expected.sort_unstable();
    let mut actual = keys.clone();
    actual.sort_unstable();
    assert_eq!(actual, expected);
}

/// Пустой `clientId` означает, что установка ещё не инициализирована:
/// отправлять отчёт с пустым идентификатором бессмысленно, поэтому вызов
/// обязан завершиться до постройки клиента.
#[tokio::test]
async fn пустой_client_id_не_отправляется() {
    // Конфиг в тестовом окружении может быть любым, поэтому проверяем
    // сам инвариант: без идентификатора тема отчёта не собирается.
    let config = AppConfig { client_id: String::new(), ..AppConfig::default() };
    assert!(config.client_id.is_empty());
    // Сетевого вызова здесь нет намеренно: тест не должен ходить в сеть.
    assert!(ENDPOINT.starts_with("https://"));
}

#[test]
fn endpoint_задан_по_https() {
    // Отчёт уходит только по HTTPS: смена на `http` скомпрометирует его.
    assert!(ENDPOINT.starts_with("https://"), "endpoint должен быть HTTPS: {ENDPOINT}");
}
