//! Секреты: система хранит их по одному, вольт остаётся для совместимости.
//!
//! # Зачем
//!
//! Старая модель хранила все секреты в конфиге как AES-256-GCM блобы под
//! общим мастер-ключом, а в системное хранилище клала только ключ
//! восстановления. Из этого следует, что любое чтение секрета на старте
//! требовало `scrypt` (N=2^14, r=8 — десятки-сотни миллисекунд) плюс
//! обращение к Credential Manager / Keychain / Secret Service. Обе операции
//! оказывались на критическом пути запуска.
//!
//! В системном хранилище лежит **каждый секрет по отдельности**,
//! поэтому подключению и запуску не нужен мастер-ключ вообще. Вольт при этом
//! не удаляется — он остаётся источником истины для бэкапа и для переноса
//! конфига на другую машину, где системного хранилища ещё нет.
//!
//! # Инварианты
//!
//! * Формат `config.json` не меняется: все новые поля опциональны и не
//!   пишутся, пока не понадобятся. Старый конфиг и бэкап читаются как есть.
//! * Вольт — источник истины для долговечности. Системное хранилище — кэш:
//!   потеря записи в нём не приводит к потере данных, миграция следующего
//!   запуска её восстановит.
//! * Секрет читается из системного хранилища **первым**. Вольт — запасной
//!   вариант, а не наоборот.
//! * Никаких обращений к системному хранилищу и KDF на старте: [`migrate`] и
//!   [`ensure_recovered`] работают в фоновой задаче после показа окна.

use std::sync::{Mutex, OnceLock};

use crate::config::{AppConfig, EncryptedSecret, SshConfig};
use crate::keychain::{self, Slot};
use crate::logger;

/// Какой секрет читается или пишется.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Password,
    KeyPassphrase,
    PrivateKey,
}

impl Kind {
    fn slot(self, server_id: &str) -> Slot {
        match self {
            Kind::Password => Slot::Password(server_id.to_owned()),
            Kind::KeyPassphrase => Slot::KeyPassphrase(server_id.to_owned()),
            Kind::PrivateKey => Slot::PrivateKey(server_id.to_owned()),
        }
    }

    /// Читаемая метка для логов.
    pub fn label(self) -> &'static str {
        match self {
            Kind::Password => "password",
            Kind::KeyPassphrase => "key passphrase",
            Kind::PrivateKey => "private key",
        }
    }
}

/// Операция над одним секретом, которую надо повторить в системном хранилище.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    /// Секрет создан или изменён.
    Set { kind: Kind, server_id: String, value: String },
    /// Секрет удалён.
    Remove { kind: Kind, server_id: String },
}

impl Op {
    fn slot(&self) -> Slot {
        match self {
            Op::Set { kind, server_id, .. } | Op::Remove { kind, server_id } => kind.slot(server_id),
        }
    }
}

// ── Очередь незаписанных операций ─────────────────────────────────────────────

/// Операции, собранные в ходе сохранения и ещё не перенесённые в системное
/// хранилище.
///
/// Очередь, а не возврат из каждой функции: `sync_favorites_secrets` и
/// `strip_plaintext_private_key` вызываются из слоя сохранения конфига, и
/// возврат пришлось бы протягивать через четыре уровня вверх, включая
/// `prepare_for_disk`, который вызывается ещё и из синхронного `save()`.
///
/// Потеря очереди при аварийном завершении безопасна: вольт к этому моменту уже
/// записан и остаётся источником истины — недостающие записи восстановит
/// миграция следующего запуска.
fn pending() -> &'static Mutex<Vec<Op>> {
    static PENDING: OnceLock<Mutex<Vec<Op>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

/// Кладёт операцию в очередь. Вызывается из кода, который уже работает с
/// открытым секретом, — то есть в момент, когда значение ещё не забыто.
pub fn stage(op: Op) {
    if let Ok(mut queue) = pending().lock() {
        queue.push(op);
    }
}

/// Забирает накопленные операции, очищая очередь.
pub fn take_pending() -> Vec<Op> {
    pending().lock().map(|mut queue| std::mem::take(&mut *queue)).unwrap_or_default()
}

/// Переносит накопленные операции в системное хранилище в отдельном потоке.
///
/// Возвращает число применённых операций: неприменённые (нет хранилища, не
/// помещается значение) возвращаются в очередь не будут — вольт их уже хранит.
pub async fn flush() -> usize {
    let ops = take_pending();
    if ops.is_empty() {
        return 0;
    }
    let total = ops.len();
    match tauri::async_runtime::spawn_blocking(move || apply_all(&ops)).await {
        Ok(applied) => {
            if applied < total {
                logger::debug(
                    "Secrets",
                    &format!("System store accepted {applied} of {total} staged secret operations"),
                );
            }
            applied
        }
        Err(err) => {
            logger::warn("Secrets", &format!("System store flush failed: {err}"));
            0
        }
    }
}

/// Применяет операции к системному хранилищу. Синхронно: вызывается из
/// `spawn_blocking` либо из тестов.
pub fn apply_all(ops: &[Op]) -> usize {
    let mut applied = 0;
    for op in ops {
        let ok = match op {
            Op::Set { value, .. } => keychain::write_slot(&op.slot(), value),
            Op::Remove { .. } => keychain::delete_slot(&op.slot()),
        };
        if ok {
            applied += 1;
        }
    }
    applied
}

// ── Миграция ──────────────────────────────────────────────────────────────────

/// Итог миграции секретов в системное хранилище.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MigrationReport {
    /// Миграция вообще выполнялась.
    ///
    /// Отдельно от счётчиков, потому что отчёт по умолчанию (задача не
    /// запустилась или упала) при нулевых счётчиках выглядел бы как успешный
    /// перенос. Без этого флага падение миграции молча пометило бы хранилище
    /// полным, и окно ввода ключа не появилось бы никогда.
    pub attempted: bool,
    /// Секретов перенесено.
    pub migrated: usize,
    /// Секретов уже было на месте.
    pub present: usize,
    /// Секретов оставлено в вольте: не помещаются в хранилище платформы.
    pub too_large: usize,
    /// Секретов, которые не удалось прочитать из вольта (закрытое хранилище).
    pub skipped: usize,
}

impl MigrationReport {
    /// Все секреты доступны без вольта.
    ///
    /// `skipped` означает, что вольт не открылся: часть секретов может лежать
    /// только там, поэтому считать хранилище достаточным нельзя.
    pub fn is_complete(&self) -> bool {
        self.attempted && self.skipped == 0 && self.too_large == 0
    }

    /// Что-то осталось в вольте — значит, хранилище нельзя считать полным.
    pub fn needs_vault(&self) -> bool {
        !self.is_complete()
    }
}

/// Переносит секреты из вольта в системное хранилище.
///
/// Требует открытого вольта: без мастер-ключа блобы не читаются. Вызывается из
/// фоновой задачи после показа окна, а не на пути к первому кадру, поэтому
/// синхронные блокирующие обращения к хранилищу здесь допустимы. Команды,
/// зовущие перенос из интерфейса, берут его через [`migrate_async`].
///
/// Идемпотентна: секрет, уже лежащий в системном хранилище, не перезаписывается
/// и тем более не перечитывается из вольта.
pub fn migrate(config: &AppConfig) -> MigrationReport {
    let mut report = MigrationReport { attempted: true, ..MigrationReport::default() };

    for (kind, secrets) in vault_secrets(config) {
        for (server_id, secret) in secrets {
            let slot = kind.slot(&server_id);
            if keychain::read_slot(&slot).is_some() {
                report.present += 1;
                continue;
            }

            let Ok(value) = crate::vault::decrypt(&secret) else {
                report.skipped += 1;
                continue;
            };

            if keychain::write_slot(&slot, &value) {
                report.migrated += 1;
            } else {
                // Хранилище недоступно либо значение не помещается: секрет
                // остаётся в вольте, и это не повод ничего портить.
                report.too_large += 1;
            }
        }
    }

    report
}

/// Перенос в отдельном потоке — для вызовов из `async`-команд, чтобы
/// блокирующие IPC к системному хранилищу не занимали worker tokio.
pub async fn migrate_async(config: AppConfig) -> MigrationReport {
    match tauri::async_runtime::spawn_blocking(move || migrate(&config)).await {
        Ok(report) => report,
        Err(err) => {
            // Отчёт по умолчанию: `attempted == false` означает «переноса не
            // было», и хранилище не будет посчитано полным.
            logger::warn("Secrets", &format!("Secret migration task failed: {err}"));
            MigrationReport::default()
        }
    }
}

/// Открывает вольт ключом из системного хранилища, не трогая конфиг.
///
/// Нужен для миграции. Возвращает `false`, если ключа в хранилище нет или он
/// не подходит к сохранённым данным: тогда приложение спросит ключ у
/// пользователя, как и раньше.
pub async fn ensure_recovered(config: &AppConfig) -> bool {
    if crate::vault::is_unlocked() {
        return true;
    }
    let Some(encryption) = config.encryption.as_ref() else { return false };
    if encryption.salt.is_empty() {
        return false;
    }

    let Some(cached) = keychain::load_recovery_key_async().await else { return false };
    if crate::vault::unlock_async(&cached, &encryption.salt).await.is_err() {
        return false;
    }
    if crate::vault::verify(encryption.check.as_ref(), sample_secret(config)) {
        return true;
    }

    // Запись в хранилище не удаляется: см. комментарий в
    // `initialize_vault_and_migrate` — она необратима и не мешает ручному вводу.
    crate::vault::lock();
    logger::warn(
        "Secrets",
        "Cached recovery key does not match stored data; secret migration skipped. \
         Enter the recovery key manually if needed.",
    );
    false
}

/// Эталонный блоб для проверки открытого вольта.
fn sample_secret(config: &AppConfig) -> Option<EncryptedSecret> {
    config
        .encrypted_passwords
        .as_ref()
        .and_then(|map| map.values().next().cloned())
}

/// Секреты вольта в виде «вид → (id сервера, блоб)».
///
/// Приватные ключи лежат не в отдельной карте, а внутри блока избранного, поэтому
/// собираются отдельно.
pub fn vault_secrets(config: &AppConfig) -> Vec<(Kind, Vec<(String, EncryptedSecret)>)> {
    let passwords = config.encrypted_passwords.clone().unwrap_or_default().into_iter().collect();
    let passphrases = config
        .encrypted_key_passphrases
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect();
    let private_keys = config
        .favorites
        .iter()
        .filter_map(|favorite| {
            let id = favorite.id.clone()?;
            let secret = favorite.private_key_secret()?;
            Some((id, secret))
        })
        .collect();

    vec![
        (Kind::Password, passwords),
        (Kind::KeyPassphrase, passphrases),
        (Kind::PrivateKey, private_keys),
    ]
}

// ── Чтение секретов ───────────────────────────────────────────────────────────

/// Что нашлось при чтении секрета.
///
/// Отдельный `Locked` нужен, чтобы отличать «пользователь не вводил ключ» от
/// «ключ есть, но блоб повреждён»: в первом случае показывается окно ввода
/// ключа, во втором — сообщение о повреждении данных.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Lookup {
    /// Секрет найден.
    Found(String),
    /// Секрета нет ни в системном хранилище, ни в вольте.
    Absent,
    /// Зашифрованный блоб есть, но вольт закрыт.
    Locked,
    /// Вольт открыт, но блоб не расшифровывается.
    Broken,
}

impl Lookup {
    pub fn into_option(self) -> Option<String> {
        match self {
            Lookup::Found(value) => Some(value),
            _ => None,
        }
    }
}

/// Результат чтения приватного ключа.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrivateKeyLookup {
    Found(Vec<u8>),
    Absent,
    Locked,
    Broken,
}

/// Системное хранилище, затем вольт.
///
/// Системное хранилище идёт первым не из соображений скорости, а из
/// независимости: мастер-ключ может быть не выведен (пользователь его не
/// вводил, а миграция ещё не прошла), и тогда вольт закрыт, тогда как системное
/// хранилище доступно всегда.
fn lookup(kind: Kind, server_id: Option<&str>, from_vault: impl FnOnce() -> Lookup) -> Lookup {
    let Some(server_id) = server_id.filter(|id| !id.is_empty()) else {
        return from_vault();
    };

    if let Some(value) = keychain::read_slot(&kind.slot(server_id)) {
        return Lookup::Found(value);
    }
    from_vault()
}

/// Расшифровка блоба из вольта с разделением причин отказа.
fn decrypt_blob(secret: &EncryptedSecret) -> Lookup {
    if !crate::vault::is_unlocked() {
        return Lookup::Locked;
    }
    match crate::vault::decrypt(secret) {
        Ok(value) => Lookup::Found(value),
        Err(_) => Lookup::Broken,
    }
}

/// Читает пароль сервера: системное хранилище, затем вольт, затем открытое
/// значение конфига.
///
/// Закрытый вольт при наличии блоба поднимает ошибку, а не возвращает «пароля
/// нет»: иначе подключение падало бы с невнятным отказом авторизации вместо
/// сообщения о заблокированном хранилище. На практике это состояние до первого
/// переноса секретов — то самое, где окно ввода ключа уже показано.
pub fn resolve_password(server: &SshConfig) -> Result<Option<String>, String> {
    let from_vault = || match server.id.as_ref() {
        Some(id) => match crate::config::load()
            .encrypted_passwords
            .as_ref()
            .and_then(|map| map.get(id))
        {
            Some(stored) => decrypt_blob(stored),
            None => Lookup::Absent,
        },
        None => Lookup::Absent,
    };

    match lookup(Kind::Password, server.id.as_deref(), from_vault) {
        Lookup::Found(value) => Ok(Some(value)),
        Lookup::Broken | Lookup::Locked => Err("errors.vaultDecryptFailed".to_owned()),
        Lookup::Absent => Ok(server.password.clone()),
    }
}

/// Пароль, который можно отдать серверу без вопроса пользователю.
///
/// Ошибку расшифровки не поднимаем: тогда сработает обычный путь отказа
/// авторизации (порт `tryResolveKnownPassword`).
pub fn known_password(server: &SshConfig, session_password: Option<String>) -> Option<String> {
    session_password.or_else(|| resolve_password(server).ok().flatten())
}

/// Читает сохранённую парольную фразу приватного ключа.
pub fn resolve_key_passphrase(server: &SshConfig) -> Option<String> {
    let from_vault = || match server.id.as_ref() {
        Some(id) => match crate::config::load()
            .encrypted_key_passphrases
            .as_ref()
            .and_then(|map| map.get(id))
        {
            Some(stored) => decrypt_blob(stored),
            None => Lookup::Absent,
        },
        None => Lookup::Absent,
    };

    lookup(Kind::KeyPassphrase, server.id.as_deref(), from_vault).into_option()
}

/// Читает приватный ключ сервера как байты.
///
/// Путь к файлу (`privateKeyPath`) не трогается: это не секрет, а ссылка на файл
/// пользователя, и в системное хранилище его класть незачем.
pub fn resolve_private_key(server: &SshConfig) -> PrivateKeyLookup {
    // Замыкание возвращает `Lookup`, чтобы переиспользовать общий порядок
    // «системное хранилище → вольт» из [`lookup`]; наружу отдаём `Vec<u8>`.
    let from_vault_lookup = || match server.private_key_secret() {
        Some(secret) => decrypt_blob(&secret),
        None => Lookup::Absent,
    };

    match lookup(Kind::PrivateKey, server.id.as_deref(), from_vault_lookup) {
        Lookup::Found(value) => PrivateKeyLookup::Found(value.into_bytes()),
        Lookup::Locked => PrivateKeyLookup::Locked,
        Lookup::Broken => PrivateKeyLookup::Broken,
        Lookup::Absent => PrivateKeyLookup::Absent,
    }
}

/// Удаляет слоты серверов, которых больше нет в конфиге.
///
/// Без этого слоты удалённых серверов остались бы в системном хранилище
/// навсегда: `save_config` присылает весь конфиг целиком, и исчезновение сервера
/// нигде не отмечается. Сверка по «было → стало» единственный способ это
/// заметить.
pub fn stage_removals(previous: &AppConfig, next: &AppConfig) {
    let next_ids: std::collections::BTreeSet<&str> = next
        .favorites
        .iter()
        .filter_map(|favorite| favorite.id.as_deref())
        .collect();

    for (kind, secrets) in vault_secrets(previous) {
        for (server_id, _) in secrets {
            if !next_ids.contains(server_id.as_str()) {
                stage(Op::Remove { kind, server_id });
            }
        }
    }
}

// ── Полная очистка ────────────────────────────────────────────────────────────

/// Удаляет из системного хранилища все слоты секретов, кроме ключа
/// восстановления.
///
/// Вызывается перед сбросом хранилища и перед импортом чужого конфига: в
/// системном хранилище не остаётся ни одной записи от прежних серверов, иначе
/// импортированный конфиг подхватил бы чужие пароли.
pub fn clear_all_secrets(config: &AppConfig) -> usize {
    let mut removed = 0;
    for (kind, secrets) in vault_secrets(config) {
        for (server_id, _) in secrets {
            if keychain::delete_slot(&kind.slot(&server_id)) {
                removed += 1;
            }
        }
    }
    removed
}

#[cfg(test)]
#[path = "tests/secrets.rs"]
mod tests;
