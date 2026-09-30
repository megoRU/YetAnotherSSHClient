//! Локализация сообщений main-процесса.
//!
//! Словарь main-процесса — подмножество `src/utils/translations.ts`, вынесенное
//! в `i18n/main.json`, чтобы не тащить в Rust весь UI-словарь. Ключи, которые
//! возвращаются во frontend (статусы подключения, тексты ошибок), обязаны
//! совпадать с TS-словарём: React сравнивает их с результатом `t()`.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use serde::Deserialize;

const DICT_JSON: &str = include_str!("../i18n/main.json");

#[derive(Debug, Deserialize)]
struct Dict {
    ru: serde_json::Value,
    en: serde_json::Value,
}

fn dict() -> &'static Dict {
    static DICT: OnceLock<Dict> = OnceLock::new();
    DICT.get_or_init(|| {
        serde_json::from_str(DICT_JSON).expect("i18n/main.json must be valid JSON")
    })
}

fn root(lang: &str) -> &'static serde_json::Value {
    let dict = dict();
    if lang == "en" {
        &dict.en
    } else {
        &dict.ru
    }
}

/// Язык для сообщений, которые ещё не привязаны к конфигу.
///
/// Берётся из сохранённой в localStorage локали webview, которую Tauri
/// сообщает при старте, и обновляется при каждом сохранении конфига.
fn current() -> &'static RwLock<String> {
    static LANG: OnceLock<RwLock<String>> = OnceLock::new();
    LANG.get_or_init(|| RwLock::new("ru".to_owned()))
}

/// Блокировка для тестов, меняющих язык.
///
/// Язык в приложении один, а тесты идут параллельно: без блокировки тест,
/// переключивший язык на `en`, ломает проверки соседнего модуля. Тест держит
/// guard до конца своей работы с языком.
#[cfg(test)]
pub fn test_guard() -> parking_lot::MutexGuard<'static, ()> {
    static TEST_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
    TEST_LOCK.lock()
}

/// Устанавливает язык сообщений main-процесса (`ru` | `en`).
pub fn set_language(lang: &str) {
    let normalized = if lang == "en" { "en" } else { "ru" };
    if let Ok(mut guard) = current().write() {
        *guard = normalized.to_owned();
    }
}

pub fn language() -> String {
    current().read().map(|value| value.clone()).unwrap_or_else(|_| "ru".to_owned())
}

/// Разрешает точечный путь в словаре и подставляет `{param}`.
pub fn t(path: &str, params: &[(&str, &str)]) -> String {
    resolve(root(&language()), path, params)
}

fn resolve(value: &serde_json::Value, path: &str, params: &[(&str, &str)]) -> String {
    let mut current = value;
    for segment in path.split('.') {
        match current.get(segment) {
            Some(next) => current = next,
            None => return path.to_owned(),
        }
    }
    match current.as_str() {
        Some(text) => interpolate(text, params),
        None => path.to_owned(),
    }
}

fn interpolate(template: &str, params: &[(&str, &str)]) -> String {
    let mut result = template.to_owned();
    for (key, value) in params {
        result = result.replacen(&format!("{{{key}}}"), value, 1);
    }
    result
}

/// Возвращает все ключи словаря для указанного языка (используется в тестах).
pub fn keys_for(lang: &str) -> Vec<String> {
    fn walk(value: &serde_json::Value, prefix: &str, out: &mut Vec<String>) {
        if let Some(map) = value.as_object() {
            for (key, child) in map {
                if key.starts_with('$') {
                    continue;
                }
                let next = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                walk(child, &next, out);
            }
        } else {
            out.push(prefix.to_owned());
        }
    }

    let mut out = Vec::new();
    walk(root(lang), "", &mut out);
    out
}

/// Собирает словарь в плоскую карту (для тестов паритета).
pub fn flat_map(lang: &str) -> HashMap<String, String> {
    keys_for(lang)
        .into_iter()
        .map(|key| {
            let value = resolve(root(lang), &key, &[]);
            (key, value)
        })
        .collect()
}

#[cfg(test)]
#[path = "tests/i18n.rs"]
mod tests;
