//! Санитизация секретов в логах — порт `src/utils/logSanitizer.ts`.
//!
//! Реализация должна оставаться семантически идентичной TypeScript-версии:
//! на неё опираются тесты `tests/logSanitizer.test.ts` и она же является
//! единственным барьером, не дающим паролям и ключам попасть в экспорт логов.

use std::borrow::Cow;
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
    // Обычное сообщение журнала не содержит ни блока ключа, ни Bearer-токена,
    // ни одного чувствительного параметра. Проверка идёт до любых аллокаций:
    // раньше на каждое сообщение создавались `Vec<String>` из строк и
    // результат `join("\n")` целиком, даже когда менять было нечего.
    if !needs_sanitizing(text) {
        return text.to_owned();
    }
    let result = replace_private_key_blocks(text);
    let result = replace_bearer_tokens(&result);
    replace_sensitive_params(&result).into_owned()
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

/// Признаки, по которым текст вообще может потребовать правки.
///
/// Проверяется до любых аллокаций: большинство сообщений журнала — обычный
/// текст без секретов, и для них все три прохода ниже не должны ни создавать
/// строки, ни разбивать вход по строкам.
fn needs_sanitizing(text: &str) -> bool {
    text.contains("-----BEGIN")
        || text.contains("Bearer ")
        || SENSITIVE_KEYS.iter().any(|key| contains_ignore_ascii_case(text, key))
}

/// Регистронезависимый поиск без аллокации: сравнивает байты в нижнем регистре
/// на ходу, тогда как `to_ascii_lowercase` создал бы копию целиком.
fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    let haystack = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
    haystack
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle))
}

fn replace_private_key_blocks(text: &str) -> Cow<'_, str> {
    // Блочная замена без регулярного выражения: ищем BEGIN/END по строкам.
    //
    // Без `-----BEGIN` в тексте блока быть не может, поэтому ничего не
    // разбиваем и не пересобираем — возвращаем исходную строку без копии.
    if !text.contains("-----BEGIN") {
        return Cow::Borrowed(text);
    }

    let mut out = String::with_capacity(text.len());
    let mut inside = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if !inside && trimmed.starts_with("-----BEGIN ") && trimmed.ends_with("PRIVATE KEY-----") {
            inside = true;
            push_line(&mut out, "[REDACTED PRIVATE KEY]");
            continue;
        }
        if inside {
            if trimmed.starts_with("-----END ") && trimmed.ends_with("PRIVATE KEY-----") {
                inside = false;
            }
            continue;
        }
        push_line(&mut out, line);
    }

    if inside {
        // Незакрытый блок: содержимое после BEGIN уже выведено как маркер,
        // хвост выводим как обычные строки.
    }

    out.into()
}

/// Добавляет строку, отделяя её от предыдущей переводом строки.
///
/// Разделитель ставится **перед** строкой, а не после: `lines()` не хранит
/// `\n`, а прежняя реализация собирала результат через `join("\n")`, то есть
/// разделяла именно оставшиеся строки. Постфиксный `\n` дал бы другой
/// результат — слипшиеся строки и висящий перевод в конце.
fn push_line(out: &mut String, line: &str) {
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(line);
}

fn replace_bearer_tokens(text: &str) -> Cow<'_, str> {
    const PREFIX: &str = "Bearer ";

    if !text.contains(PREFIX) {
        return Cow::Borrowed(text);
    }

    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(pos) = rest.find(PREFIX) {
        out.push_str(&rest[..pos]);
        // Префикс `Bearer ` сохраняется: в логах остаётся видно, что это был
        // токен (так же ведёт себя TypeScript-версия, см. `logSanitizer.ts`).
        out.push_str(&rest[pos..pos + PREFIX.len()]);
        out.push_str("[REDACTED]");

        let after = &rest[pos + PREFIX.len()..];
        let end = after
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ',' || c == ';')
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out.into()
}

fn replace_sensitive_params(text: &str) -> Cow<'_, str> {
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

    // Без ключа в тексте заменять нечего: возвращаем его без копии.
    // Это же отсекает большинство сообщений журнала.
    if !KEYS.iter().any(|key| contains_ignore_ascii_case(text, key)) {
        return Cow::Borrowed(text);
    }

    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    // `to_ascii_lowercase` не меняет длину в байтах, поэтому строчный снимок
    // остатка можно получать срезом из снимка исходной строки, а не
    // пересчитывать. Раньше он пересоздавался на каждой итерации цикла, то
    // есть стоимость росла вместе с числом найденных секретов.
    let lowered = text.to_ascii_lowercase();
    let mut lower = lowered.as_str();

    'outer: loop {
        let mut best: Option<(usize, usize)> = None; // (start, len) вхождения ключа
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
            lower = tail_of(&lowered, rest);
            continue;
        }

        // Разделитель — `:`/`=` с необязательными пробелами вокруг (в TS это
        // группа `[:=]\s*`) либо одиночный пробел (группа `\s+`); в обоих
        // случаях он попадает в результат целиком.
        //
        // Пробелы после разделителя принадлежат ему, а не значению, поэтому
        // начало значения ищется по `trim_start`, а не фиксированным сдвигом.
        // Раньше здесь стояла длина остатка (`stripped.len()`), и при значении
        // длиннее символа хвост строки (`password=secret port=22`) попадал под
        // замену вместе с секретом.
        let mut value_start = if trimmed.starts_with(':') || trimmed.starts_with('=') { 1 } else { 0 };
        let value_text = trimmed[value_start..].trim_start();
        value_start += trimmed[value_start..].len() - value_text.len();
        out.push_str(&trimmed[..value_start]);

        let value_offset = start + key_len + (after_key.len() - trimmed.len()) + value_start;
        let value = read_value(value_text);
        out.push_str("[REDACTED]");
        rest = &rest[value_offset + value..];
        lower = tail_of(&lowered, rest);
    }

    out.into()
}

/// Строчный снимок того же суффикса, что и `rest`.
///
/// `rest` всегда суффикс исходного текста, а `to_ascii_lowercase` не меняет
/// длину в байтах, поэтому позиция суффикса в снимке равна разности длин.
fn tail_of<'a>(lowered: &'a str, rest: &str) -> &'a str {
    &lowered[lowered.len() - rest.len()..]
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
#[path = "tests/sanitize.rs"]
mod tests;
