//! Каталог опасных команд MCP и распознавание их в команде агента.
//!
//! Единственный источник списка: его же получает UI в составе статуса сервера
//! (`McpStatus.danger_commands`), поэтому настройка и проверка выполнения не
//! могут разойтись. Правило — строка либо из одного слова (`rm`), либо фраза
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
/// пользователь отключил. Оболочки и `xargs` — потому что выполняют свою
/// команду: `sh -c "rm -rf /"`, `find . | xargs rm`.
const WRAPPERS: &[&str] = &[
    "sudo", "doas", "env", "command", "nohup", "nice", "ionice", "time", "stdbuf", "setsid", "timeout", "busybox",
    "sh", "bash", "zsh", "dash", "xargs",
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
/// учитываются ни в каком режиме.
/// Возвращает строку правила (`"rm"`, `"systemctl restart ssh"`).
pub fn find_dangerous(command: &str, disabled: &[String]) -> Option<&'static str> {
    // `$()` и обратные кавычки выполняют вложенные команды: считаем их
    // границей сегмента, иначе `echo $(rm -rf /)` до `rm` не доходит.
    let normalized = command.replace("$(", ";").replace('`', ";");
    for segment in normalized.split([';', '|', '&', '\n', '\r']) {
        let tokens: Vec<&str> = segment.split_whitespace().collect();
        for (index, token) in tokens.iter().enumerate() {
            // Остаток сегмента — для фраз: `sudo systemctl restart ssh`
            // должен находить правило «systemctl restart ssh».
            let rest = segment_tail(&tokens, index);
            if let Some(rule) = match_phrase(&rest, disabled) {
                return Some(rule);
            }
            if let Some(rule) = match_word(token, disabled) {
                return Some(rule);
            }
            // Значение флага (`sudo -u root rm` → `root`) не может быть
            // командой, но и не обрывает поиск: до `rm` ещё нужно дойти.
            if !is_skippable(token) && !is_flag_value(&tokens, index) {
                break;
            }
        }
    }
    None
}

/// Остаток сегмента от `index` для фразовых правил.
///
/// Первый токен берётся без пути и оформления шелла, чтобы
/// `/bin/systemctl restart sshd` сопоставлялся с фразой `systemctl restart sshd`.
fn segment_tail(tokens: &[&str], index: usize) -> String {
    let mut parts: Vec<&str> = tokens[index..].to_vec();
    let first = clean_word(parts[0]);
    parts[0] = first;
    parts.join(" ").to_lowercase()
}

/// Фразовое правило, совпадающее с началом остатка сегмента.
fn match_phrase(rest: &str, disabled: &[String]) -> Option<&'static str> {
    for (_, commands) in CATEGORIES {
        for rule in commands.iter().filter(|rule| rule.contains(' ')) {
            if disabled.iter().any(|value| value == *rule) {
                continue;
            }
            // Граница слова обязательна: `systemctl restart ssh` не должно
            // срабатывать на `systemctl restart sshd`. Точка справа — суффикс
            // юнита systemd: `systemctl restart sshd.service`.
            if rest == *rule
                || rest.starts_with(&format!("{rule} "))
                || rest.starts_with(&format!("{rule}."))
            {
                return Some(rule);
            }
        }
    }
    None
}

/// Правило-слово, совпадающее с токеном (с учётом путей и суффиксов).
fn match_word(token: &str, disabled: &[String]) -> Option<&'static str> {
    let word = clean_word(token).to_lowercase();
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

/// Значимое слово токена: без пути и оформления шелла.
///
/// `/usr/bin/rm`, `` `rm` ``, `"rm"`, `$(rm` → `rm`.
fn clean_word(token: &str) -> &str {
    basename(token).trim_matches(|character| matches!(character, '`' | '\'' | '"' | '(' | ')' | '$'))
}

/// Токен — значение флага (`sudo -u root rm` → `root`).
///
/// Дойти до такого токена можно только сквозь уже пропущенные токены, поэтому
/// достаточно признака «предыдущий токен — флаг»: обычные аргументы недостижимы,
/// поиск останавливается на имени программы (`ls rm` до `rm` не доходит).
fn is_flag_value(tokens: &[&str], index: usize) -> bool {
    index > 0
        && clean_word(tokens[index - 1]).starts_with('-')
        && !clean_word(tokens[index]).starts_with('-')
}

/// Токен, который не может быть значимой командой: обёртка, присваивание
/// окружения, флаг или число (`timeout 60 rm` → `rm`).
fn is_skippable(token: &str) -> bool {
    let lower = clean_word(token).to_lowercase();
    WRAPPERS.contains(&lower.as_str())
        || lower.contains('=')
        || lower.starts_with('-')
        || lower.chars().all(|character| character.is_ascii_digit())
}

#[cfg(test)]
#[path = "tests/mcp_danger.rs"]
mod tests;
