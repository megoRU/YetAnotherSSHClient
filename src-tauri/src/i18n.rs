//! Формирует ключи локализации для передачи в UI.
//!
//! Переводы хранятся только в `src/utils/translations.ts`. Rust передаёт
//! структурированный ключ с параметрами, а Tauri-мост подставляет перевод,
//! используя текущую локаль интерфейса.
use std::collections::BTreeMap;

/// Создаёт маркер, который renderer переводит через общий словарь UI.
pub fn t(path: &str, params: &[(&str, &str)]) -> String {
    let params: BTreeMap<&str, &str> = params.iter().map(|(key, value)| (*key, *value)).collect();
    let payload = serde_json::json!({ "key": path, "params": params });
    format!("\u{1e}YASSH_I18N:{}\u{1f}", payload)
}

#[cfg(test)]
#[path = "tests/i18n.rs"]
mod tests;
