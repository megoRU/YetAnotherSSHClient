use super::*;
use crate::tests::fixtures::{pem_begin, pem_envelope, FAKE_PASSWORD, FAKE_TOKEN};

#[test]
fn маскирует_приватный_ключ() {
    let header = pem_begin("OPENSSH PRIVATE KEY");
    let text = format!("ошибка:\n{}\nконец", pem_envelope("OPENSSH PRIVATE KEY"));
    let result = sanitize_text(&text);
    assert!(!result.contains(&header), "заголовок приватного ключа не замаскирован");
    assert!(result.contains("[REDACTED PRIVATE KEY]"));
}

#[test]
fn маскирует_bearer_и_пароль() {
    let bearer = format!("Authorization: Bearer {FAKE_TOKEN}");
    assert!(sanitize_text(&bearer).contains("Bearer [REDACTED]"));
    assert_eq!(sanitize_text(&format!("password={FAKE_PASSWORD} port=22")), "password=[REDACTED] port=22");
    assert_eq!(sanitize_text(&format!("token: {FAKE_TOKEN}")), "token: [REDACTED]");
}

#[test]
fn маскирует_чувствительные_поля_объекта() {
    let value = serde_json::json!({ "host": "example.com", "password": "x", "nested": { "token": "y" } });
    let result = sanitize_value(&value);
    assert_eq!(result["host"], "example.com");
    assert_eq!(result["password"], "[REDACTED]");
    assert_eq!(result["nested"]["token"], "[REDACTED]");
}
