//! Каталог опасных команд MCP и распознавание их в команде агента.
//!
//! Единственный источник списка: его же получает UI через команду
//! `mcp_get_danger_rules`, поэтому настройка и проверка выполнения не могут
//! разойтись. Правило — строка либо из одного слова (`rm`), либо фраза
//! (`systemctl restart ssh`): слово сравнивается со значимым словом сегмента,
//! фраза — с началом остатка сегмента по границе слова.

use serde::Serialize;

/// Категория опасных команд.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DangerCategory {
    /// Стабильный идентификатор: ключ локализации UI (`mcp.dangerCategory.<id>`).
    pub id: String,
    /// Правила категории: строки команд, по которым идёт распознавание.
    pub commands: Vec<String>,
}

/// Каталог опасных команд.
///
/// Идентификаторы категорий и строк правил хранятся в конфиге
/// (`mcp_disabled_danger_commands`), поэтому править их можно только вместе
/// с миграцией.
const CATEGORIES: &[(&str, &[&str])] = &[
    ("fileDeletion", &["rm", "rmdir", "shred"]),
    (
        "diskOperations",
        &["mkfs", "fdisk", "parted", "dd", "wipefs", "format", "mount", "umount"],
    ),
    ("firewall", &["iptables", "nft", "ufw", "firewall-cmd"]),
    ("userManagement", &["useradd", "userdel", "usermod", "passwd", "visudo"]),
    (
        "sshConfiguration",
        &[
            "sshd",
            "systemctl restart ssh",
            "systemctl restart sshd",
            "systemctl reload ssh",
            "systemctl reload sshd",
            "service ssh restart",
            "service sshd restart",
        ],
    ),
    ("serviceManagement", &["systemctl", "service"]),
    ("systemPower", &["shutdown", "reboot", "poweroff", "halt", "init"]),
    ("privilegeEscalation", &["sudo"]),
    ("permissions", &["chmod", "chown", "chgrp"]),
    ("scheduledTasks", &["crontab"]),
    ("processes", &["kill", "killall", "pkill"]),
    ("containersIac", &["docker", "podman", "kubectl", "terraform", "virsh"]),
];

/// Команды-обёртки: значимым считается слово после них.
///
/// `sudo` входит и в каталог (правило привилегий), и сюда: одиночный `sudo`
/// всё равно находится, а `sudo rm` — через `rm`, даже если правило `sudo`
/// пользователь отключил.
const WRAPPERS: &[&str] = &[
    "sudo", "doas", "env", "command", "nohup", "nice", "ionice", "time", "stdbuf", "setsid", "timeout", "busybox",
];

/// Каталог для UI: структурированный список категорий с правилами.
pub fn categories() -> Vec<DangerCategory> {
    CATEGORIES
        .iter()
        .map(|(id, commands)| DangerCategory {
            id: (*id).to_owned(),
            commands: commands.iter().map(|command| (*command).to_owned()).collect(),
        })
        .collect()
}

/// Ищет первое сработавшее опасное правило в команде агента.
///
/// `disabled` — правила, которые пользователь счёл безопасными: они не
/// учитываются. Возвращает строку правила (`"rm"`, `"systemctl restart ssh"`).
pub fn find_dangerous(command: &str, disabled: &[String]) -> Option<&'static str> {
    for segment in command.split([';', '|', '&', '\n', '\r']) {
        let tokens: Vec<&str> = segment.split_whitespace().collect();
        for (index, token) in tokens.iter().enumerate() {
            // Остаток сегмента — для фраз: `sudo systemctl restart ssh`
            // должен находить правило «systemctl restart ssh».
            let rest = tokens[index..].join(" ").to_lowercase();
            if let Some(rule) = match_phrase(&rest, disabled) {
                return Some(rule);
            }
            if let Some(rule) = match_word(token, disabled) {
                return Some(rule);
            }
            if !is_skippable(token) {
                break;
            }
        }
    }
    None
}

/// Фразовое правило, совпадающее с началом остатка сегмента.
fn match_phrase(rest: &str, disabled: &[String]) -> Option<&'static str> {
    for (_, commands) in CATEGORIES {
        for rule in commands.iter().filter(|rule| rule.contains(' ')) {
            if disabled.iter().any(|value| value == *rule) {
                continue;
            }
            // Граница слова обязательна: `systemctl restart ssh` не должно
            // срабатывать на `systemctl restart sshd`.
            if rest == *rule || rest.starts_with(&format!("{rule} ")) {
                return Some(rule);
            }
        }
    }
    None
}

/// Правило-слово, совпадающее с токеном (с учётом путей и суффиксов).
fn match_word(token: &str, disabled: &[String]) -> Option<&'static str> {
    let word = basename(token).to_lowercase();
    for (_, commands) in CATEGORIES {
        for rule in commands.iter().filter(|rule| !rule.contains(' ')) {
            if disabled.iter().any(|value| value == *rule) {
                continue;
            }
            // `mkfs.ext4`, `iptables-restore` — те же опасные команды.
            if word == *rule || word.starts_with(&format!("{rule}.")) || word.starts_with(&format!("{rule}-")) {
                return Some(rule);
            }
        }
    }
    None
}

/// Последний компонент пути: `/usr/bin/rm` → `rm`.
fn basename(token: &str) -> &str {
    token.rsplit('/').next().unwrap_or(token)
}

/// Токен, который не может быть значимой командой: обёртка, присваивание
/// окружения, флаг или число (`timeout 60 rm` → `rm`).
fn is_skippable(token: &str) -> bool {
    let word = basename(token);
    let lower = word.to_lowercase();
    WRAPPERS.contains(&lower.as_str())
        || lower.contains('=')
        || word.starts_with('-')
        || word.chars().all(|character| character.is_ascii_digit())
}

#[cfg(test)]
#[path = "tests/mcp_danger.rs"]
mod tests;
