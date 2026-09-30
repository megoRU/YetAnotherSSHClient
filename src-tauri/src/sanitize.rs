//! Санитизация секретов в логах — порт `src/utils/logSanitizer.ts`.
//!
//! Реализация должна оставаться семантически идентичной TypeScript-версии:
//! на неё опираются тесты `tests/logSanitizer.test.ts` и она же является
//! единственным барьером, не дающим паролям и ключам попасть в экспорт логов.

use std::collections::BTreeSet;
use std::sync::OnceLock;

const SENSITIVE_KEYS: &[&str] = &[
    "password",
    "passwd",
    "passphrase",
    "sshpassword",
    "passwordhash",
    "token",
    "apitoken",
    "clienttoken",
    "accesstoken",
    "refreshtoken",
    "secret",
    "clientsecret",
    "privatekey",
    "private_key",
    "sshkey",
    "ssh_key",
    "authorization",
    "apikey",
    "recoverykey",
];

fn sensitive_keys() -> &'static BTreeSet<String> {
    static SET: OnceLock<BTreeSet<String>> = OnceLock::new();
    SET.get_or_init(|| SENSITIVE_KEYS.iter().map(|k| k.to_ascii_lowercase()).collect())
}

fn is_sensitive_key(key: &str) -> bool {
    sensitive_keys().contains(&key.to_ascii_lowercase())
}

/// Заменяет приватные ключи, Bearer-токены и значения чувствительных параметров.
pub fn sanitize_text(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let result = replace_private_key_blocks(text);
    let result = replace_bearer_tokens(&result);
    replace_sensitive_params(&result)
}

/// Полная очистка значения `serde_json::Value` (пароли, Bearer, ключи).
///
/// Значения по «чувствительным» ключам заменяются на `[REDACTED]`; строковые
/// значения дополнительно проходят [`sanitize_text`]. Циклы заменяются на
/// `[CIRCULAR]`, глубина рекурсии ограничена.
pub fn sanitize_value(value: &serde_json::Value) -> serde_json::Value {
    sanitize_value_inner(value, 0)
}

fn sanitize_value_inner(value: &serde_json::Value, depth: usize) -> serde_json::Value {
    const MAX_DEPTH: usize = 32;

    if depth > MAX_DEPTH {
        return serde_json::Value::String("[CIRCULAR]".to_owned());
    }

    match value {
        serde_json::Value::String(text) => serde_json::Value::String(sanitize_text(text)),
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items
                .iter()
                .map(|item| sanitize_value_inner(item, depth + 1))
                .collect(),
        ),
        serde_json::Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, item) in map {
                if is_sensitive_key(key) {
                    out.insert(key.clone(), serde_json::Value::String("[REDACTED]".to_owned()));
                } else {
                    out.insert(key.clone(), sanitize_value_inner(item, depth + 1));
                }
            }
            serde_json::Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Форматирует аргумент логирования в строку, предварительно очищая его.
pub fn format_arg(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => sanitize_text(text),
        serde_json::Value::Null => "null".to_owned(),
        other => serde_json::to_string(&sanitize_value(other)).unwrap_or_else(|_| String::from("<unserializable>")),
    }
}

// ── Внутренние замены ─────────────────────────────────────────────────────────

fn replace_private_key_blocks(text: &str) -> String {
    // Блочная замена без регулярного выражения: ищем BEGIN/END по строкам.
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut inside = false;

    for line in lines {
        let trimmed = line.trim();
        if !inside && trimmed.starts_with("-----BEGIN ") && trimmed.ends_with("PRIVATE KEY-----") {
            inside = true;
            out.push("[REDACTED PRIVATE KEY]".to_owned());
            continue;
        }
        if inside {
            if trimmed.starts_with("-----END ") && trimmed.ends_with("PRIVATE KEY-----") {
                inside = false;
            }
            continue;
        }
        out.push(line.to_owned());
    }

    if inside {
        // Незакрытый блок: содержимое после BEGIN уже выведено как маркер,
        // хвост выводим как обычные строки.
    }

    out.join("\n")
}

fn replace_bearer_tokens(text: &str) -> String {
    const PREFIX: &str = "Bearer ";

    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(pos) = rest.find(PREFIX) {
        out.push_str(&rest[..pos]);
        out.push_str("[REDACTED]");

        let after = &rest[pos + PREFIX.len()..];
        let end = after
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ',' || c == ';')
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

fn replace_sensitive_params(text: &str) -> String {
    // Ключи из того же списка, что и в TS-версии, в нижнем регистре; сравнение
    // регистронезависимое, как и флаг `i` у JS-регулярки.
    const KEYS: &[&str] = &[
        "password",
        "passwd",
        "passphrase",
        "sshpassword",
        "passwordhash",
        "token",
        "apitoken",
        "clienttoken",
        "accesstoken",
        "refreshtoken",
        "secret",
        "clientsecret",
        "privatekey",
        "private_key",
        "sshkey",
        "ssh_key",
        "apikey",
        "recoverykey",
    ];

    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    'outer: loop {
        let mut best: Option<(usize, usize)> = None; // (start, len) вхождения ключа
        let lower = rest.to_ascii_lowercase();
        for key in KEYS {
            if let Some(pos) = lower.find(key) {
                if best.map_or(true, |(start, _)| pos < start) {
                    best = Some((pos, key.len()));
                }
            }
        }
        let Some((start, key_len)) = best else {
            out.push_str(rest);
            break 'outer;
        };

        out.push_str(&rest[..start]);
        let key_text = &rest[start..start + key_len];
        out.push_str(key_text);

        // После ключа допустим разделитель `:` или `=` с необязательным
        // пробелом либо пробел (как в TS-версии: `[:=]\s*|\s+`).
        let after_key = &rest[start + key_len..];
        let trimmed = after_key.trim_start();
        let had_separator = trimmed.len() != after_key.len() || trimmed.starts_with(':') || trimmed.starts_with('=');
        if !had_separator {
            rest = after_key;
            continue;
        }

        let (separator, value_start) = if let Some(stripped) = trimmed.strip_prefix(':') {
            (":", stripped.len())
        } else if let Some(stripped) = trimmed.strip_prefix('=') {
            ("=", stripped.len())
        } else {
            (" ", 0)
        };
        out.push_str(separator);

        let value_area = &trimmed[value_start..];
        let value_offset = start + key_len + (after_key.len() - trimmed.len()) + value_start;
        let value = read_value(value_area);
        out.push_str("[REDACTED]");
        rest = &rest[value_offset + value..];
    }

    out
}

/// Возвращает длину значения параметра: `"..."`, `'...'` или до разделителя.
fn read_value(area: &str) -> usize {
    let mut chars = area.char_indices();
    let Some((_, first)) = chars.next() else {
        return 0;
    };

    if first == '"' || first == '\'' {
        let quote = first;
        let mut end = 1;
        for (offset, ch) in chars {
            if ch == quote {
                end = offset + ch.len_utf8();
                break;
            }
            end = offset + ch.len_utf8();
        }
        return end;
    }

    area
        .find(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .unwrap_or(area.len())
}

#[cfg(test)]
mod tests {
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
}
