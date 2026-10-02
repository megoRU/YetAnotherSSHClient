use super::*;

#[test]
fn маскирует_приватный_ключ() {
    let text = "ошибка:\n-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\nконец";
    let result = sanitize_text(text);
    assert!(!result.contains("BEGIN OPENSSH PRIVATE KEY"));
    assert!(result.contains("[REDACTED PRIVATE KEY]"));
}

#[test]
fn маскирует_bearer_и_пароль() {
    assert!(sanitize_text("Authorization: Bearer abc.def-_~xyz=").contains("Bearer [REDACTED]"));
    assert_eq!(sanitize_text("password=hunter2 port=22"), "password=[REDACTED] port=22");
    assert_eq!(sanitize_text("token: s3cr3t"), "token: [REDACTED]");
}

#[test]
fn маскирует_чувствительные_поля_объекта() {
    let value = serde_json::json!({ "host": "example.com", "password": "x", "nested": { "token": "y" } });
    let result = sanitize_value(&value);
    assert_eq!(result["host"], "example.com");
    assert_eq!(result["password"], "[REDACTED]");
    assert_eq!(result["nested"]["token"], "[REDACTED]");
}
