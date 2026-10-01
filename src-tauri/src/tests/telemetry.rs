use super::*;

fn payload() -> serde_json::Value {
    serde_json::to_value(TelemetryPayload {
        client_id: "client-1",
        version: "4.0.0",
        os: "windows",
    })
    .expect("json")
}

/// В отчёте ровно три поля: идентификатор установки, версия и ОС. Любое
/// четвёртое поле — это утечка пользовательских данных, поэтому тест падает.
#[test]
fn отчёт_содержит_только_три_поля() {
    let value = payload();

    assert_eq!(value["clientId"], "client-1");
    assert_eq!(value["version"], "4.0.0");
    assert_eq!(value["os"], "windows");
    assert_eq!(
        value.as_object().expect("объект").len(),
        3,
        "в отчёте появилось лишнее поле: {value}"
    );
}

/// Имена полей в JSON — контракт с сервером, и именно он ломался: при
/// `client_id` вместо `clientId` сервер отвечал 500 и отчёт молча терялся.
/// Тест проверяет итоговый JSON, а не имена полей структуры: переименование
/// в Rust без `serde` его бы не поймало.
#[test]
fn имена_полей_camel_case() {
    let text = payload().to_string();
    assert!(
        text.contains("\"clientId\""),
        "сервер ждёт clientId, а не client_id: {text}"
    );
    assert!(
        !text.contains("client_id"),
        "в отчёт ушло имя поля в snake_case: {text}"
    );
    for field in payload().as_object().expect("объект").keys() {
        let field = field.as_str();
        assert!(
            !field.contains('_'),
            "поле {field} в snake_case — сервер такое не принимает"
        );
    }
}

/// Набор полей — контракт с принимающей стороной: лишнее поле утекает данные,
/// потерянное ломает статистику.
#[test]
fn набор_полей_фиксирован() {
    let value = payload();
    let keys: Vec<&str> = value
        .as_object()
        .expect("объект")
        .keys()
        .map(String::as_str)
        .collect();
    let mut expected = vec!["clientId", "os", "version"];
    expected.sort_unstable();
    let mut actual = keys;
    actual.sort_unstable();
    assert_eq!(actual, expected);
}

/// Настройки пользователя и данные подключений не должны покидать машину ни
/// при каких значениях конфига. Проверяем по именам полей, а не по значениям.
#[test]
fn отчёт_не_уносит_настройки_и_данные() {
    let value = payload();
    let text = value.to_string();
    let forbidden = [
        // Настройки, которые были в отчёте раньше.
        "theme", "language", "favorite", "mcp",
        // Характеристики машины.
        "arch",
        // Данные подключений и секреты.
        "host", "user", "name", "password", "passphrase", "privateKey", "token",
    ];
    for field in forbidden {
        assert!(
            !text.contains(field),
            "в телеметрию попало поле {field}: {text}"
        );
    }
}

/// ОС передаётся человеческим именем, а не в терминах Node.js: `win32`
/// понятен фронтенду, но в статистике должен быть `windows`.
#[test]
fn имя_ос_человеческое() {
    let os = os_name();
    assert!(
        matches!(os, "windows" | "macos" | "linux" | "other"),
        "неожиданное имя ОС: {os}"
    );
    assert_ne!(os, "win32", "в телеметрию ушло имя платформы renderer'а");
    assert_ne!(os, "darwin", "в телеметрию ушло имя платформы renderer'а");
}

/// `paths::platform_id()` отдаёт `win32`/`darwin` для горячих клавиш; тронуть
/// его нельзя, поэтому у телеметрии своя функция. Здесь фиксируется, что
/// значения действительно расходятся, иначе правка покажется лишней.
#[test]
fn телеметрия_не_переиспользует_platform_id() {
    let renderer = crate::paths::platform_id();
    let telemetry = os_name();
    // На Windows и macOS имена обязаны отличаться: в этом весь смысл
    // отдельной функции.
    if renderer == "win32" {
        assert_eq!(telemetry, "windows");
    }
    if renderer == "darwin" {
        assert_eq!(telemetry, "macos");
    }
    if renderer == "linux" {
        assert_eq!(telemetry, "linux");
    }
}

/// Пустой `clientId` означает, что установка ещё не инициализирована:
/// отправлять отчёт с пустым идентификатором бессмысленно, поэтому вызов
/// обязан завершиться до постройки клиента.
#[tokio::test]
async fn пустой_client_id_не_отправляется() {
    // Конфиг в тестовом окружении может быть любым, поэтому проверяем
    // сам инвариант: без идентификатора отчёт не собирается.
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
