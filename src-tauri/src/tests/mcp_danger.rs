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
    // Перезапуском это не является, но само `systemctl` — правило категории
    // serviceManagement и срабатывает как одиночное слово.
    assert_eq!(find_dangerous("systemctl status ssh", &[]), Some("systemctl"));
}

#[test]
fn обходы_через_sudo_и_значения_флагов() {
    // Одиночное правило sudo срабатывает на любую команду с ним.
    assert_eq!(find_dangerous("sudo ls", &[]), Some("sudo"));
    // Даже если правило sudo отключено, команда за его флагами находится:
    // значение флага (`root`, `www-data`) не обрывает поиск.
    let disabled = disabled(&["sudo"]);
    assert_eq!(find_dangerous("sudo -u root chmod 777 /var/www", &disabled), Some("chmod"));
    assert_eq!(find_dangerous("sudo -u www-data crontab -e", &disabled), Some("crontab"));
    assert_eq!(find_dangerous("doas rm file", &disabled), Some("rm"));
    // Обычные аргументы при этом не достаются ложно: `ls rm` останавливается
    // на `ls` и до `rm` не доходит.
    assert_eq!(find_dangerous("ls rm", &disabled), None);
}

#[test]
fn абсолютные_пути_и_суффиксы_команд() {
    assert_eq!(find_dangerous("/usr/bin/rm -rf /var", &[]), Some("rm"));
    assert_eq!(find_dangerous("/usr/sbin/mkfs.ext4 -f /dev/sdb1", &[]), Some("mkfs"));
    // Фраза сравнивается по значимой части первого токена.
    assert_eq!(find_dangerous("/bin/systemctl restart sshd", &[]), Some("systemctl restart sshd"));
    assert_eq!(find_dangerous("iptables-restore < rules.v4", &[]), Some("iptables"));
}

#[test]
fn systemd_суффиксы_и_границы_юнитов() {
    assert_eq!(find_dangerous("systemctl restart sshd.service", &[]), Some("systemctl restart sshd"));
    assert_eq!(find_dangerous("systemctl restart ssh.service", &[]), Some("systemctl restart ssh"));
    assert_eq!(find_dangerous("/sbin/service ssh restart", &[]), Some("service ssh restart"));
    // Граница слова: `ssh` не срабатывает на `sshd` и наоборот.
    assert_eq!(find_dangerous("systemctl reload ssh", &[]), Some("systemctl reload ssh"));
    assert_eq!(find_dangerous("systemctl reload sshd", &[]), Some("systemctl reload sshd"));
}

#[test]
fn обходы_через_шелл_операторы_и_оформление() {
    assert_eq!(find_dangerous("cd /tmp; rm -rf build", &[]), Some("rm"));
    assert_eq!(find_dangerous("apt-get update || rm -rf /", &[]), Some("rm"));
    // Обратные кавычки и `$()` запускают вложенные команды.
    assert_eq!(find_dangerous("echo `rm -rf /`", &[]), Some("rm"));
    assert_eq!(find_dangerous("echo $(rm -rf /)", &[]), Some("rm"));
    // Кавычки вокруг команды и запуск через оболочку.
    assert_eq!(find_dangerous("\"rm\" -rf /", &[]), Some("rm"));
    assert_eq!(find_dangerous("sh -c \"rm -rf /\"", &[]), Some("rm"));
}

#[test]
fn косвенное_выполнение_скриптов_требует_подтверждения() {
    // Содержимое eval может быть переменной или собираться во время работы,
    // поэтому опасным считается сам механизм косвенного выполнения.
    assert_eq!(find_dangerous("eval \"$command\"", &[]), Some("eval"));
    assert_eq!(find_dangerous("source ./maintenance.sh", &[]), Some("source"));
    assert_eq!(find_dangerous(". ./maintenance.sh", &[]), Some("."));
}

#[test]
fn отключённые_правила_не_срабатывают() {
    // Правило каталога можно отключить — оно не считается опасным.
    let disabled = disabled(&["rmdir"]);
    assert_eq!(find_dangerous("rmdir dir", &disabled), None);
    // Остальные правила каталога продолжают работать.
    assert_eq!(find_dangerous("chmod 777 file", &disabled), Some("chmod"));
}

#[test]
fn отключить_можно_любое_правило_включая_разрушительные() {
    let disabled = disabled(&["sudo", "rm", "mkfs", "dd", "reboot"]);
    // Выключенные пользователем правила не срабатывают — каких бы они
    // категорий ни были.
    assert_eq!(find_dangerous("rm -rf /", &disabled), None);
    assert_eq!(find_dangerous("mkfs.ext4 /dev/sdb1", &disabled), None);
    assert_eq!(find_dangerous("dd if=/dev/zero of=/dev/sda", &disabled), None);
    assert_eq!(find_dangerous("reboot now", &disabled), None);
    // Оба правила выключены — команда проходит без подтверждения.
    assert_eq!(find_dangerous("sudo rm -rf /", &disabled), None);
    // Правила, которых нет в списке, продолжают находиться.
    assert_eq!(find_dangerous("shutdown now", &disabled), Some("shutdown"));
}

#[test]
fn каталог_покрывает_все_правила() {
    let catalog = categories();
    assert_eq!(catalog.len(), 13);
    assert!(catalog.iter().any(|category| category.id == "sshConfiguration"));
    assert!(catalog.iter().all(|category| !category.commands.is_empty()));
}
