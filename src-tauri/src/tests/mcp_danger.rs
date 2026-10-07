//! Тесты распознавания опасных команд MCP.

use super::{categories, find_dangerous};

fn disabled(rules: &[&str]) -> Vec<String> {
    rules.iter().map(|rule| (*rule).to_owned()).collect()
}

#[test]
fn находит_простую_команду() {
    assert_eq!(find_dangerous("rm -rf /var", &[]), Some("rm"));
    assert_eq!(find_dangerous("mkfs.ext4 /dev/sdb1", &[]), Some("mkfs"));
    assert_eq!(find_dangerous("/usr/bin/rm file", &[]), Some("rm"));
}

#[test]
fn безопасные_команды_не_срабатывают() {
    assert_eq!(find_dangerous("ls -la /tmp", &[]), None);
    assert_eq!(find_dangerous("cat /usr/bin/rm", &[]), None);
    assert_eq!(find_dangerous("grep rm notes.txt", &[]), None);
}

#[test]
fn находит_команду_за_обёртками_и_операторами() {
    assert_eq!(find_dangerous("cd /tmp && rm file", &[]), Some("rm"));
    assert_eq!(find_dangerous("sudo systemctl restart ssh", &[]), Some("sudo"));
    assert_eq!(find_dangerous("timeout 60 rm -f file", &[]), Some("rm"));
    assert_eq!(find_dangerous("FOO=bar rmdir dir", &[]), Some("rmdir"));
}

#[test]
fn фразы_сохраняют_границу_слова() {
    assert_eq!(find_dangerous("systemctl restart ssh", &[]), Some("systemctl restart ssh"));
    assert_eq!(find_dangerous("systemctl restart sshd", &[]), Some("systemctl restart sshd"));
    assert_eq!(find_dangerous("systemctl status ssh", &[]), None);
}

#[test]
fn отключённые_правила_не_срабатывают() {
    let disabled = disabled(&["rm"]);
    assert_eq!(find_dangerous("rm -rf /var", &disabled), None);
    // Остальные правила каталога продолжают работать.
    assert_eq!(find_dangerous("rmdir dir", &disabled), Some("rmdir"));
}

#[test]
fn каталог_покрывает_все_правила() {
    let catalog = categories();
    assert_eq!(catalog.len(), 12);
    assert!(catalog.iter().any(|category| category.id == "sshConfiguration"));
    assert!(catalog.iter().all(|category| !category.commands.is_empty()));
}
