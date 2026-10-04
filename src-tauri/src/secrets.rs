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

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Mutex, OnceLock};

use crate::config::{AppConfig, EncryptedSecret, SshConfig};
use crate::keychain::{self, Slot};
use crate::logger;

/// Какой секрет читается или пишется.
///
/// `Ord` нужен как часть ключа очереди: слоты склеиваются по `(вид, id)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
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
#[derive(Debug, PartialEq, Eq)]
pub enum Op {
    /// Секрет создан или изменён.
    Set { kind: Kind, server_id: String, value: String },
    /// Секрет удалён.
    Remove { kind: Kind, server_id: String },
}

impl Op {
    /// Слот, к которому относится операция.
    ///
    /// Читается один раз на применение, поэтому [`Self::kind`] и
    /// [`Self::server_id`] дублируют разбор: из них собирается ключ очереди, а
    /// здесь нужен готовый слот.
    fn slot(&self) -> Slot {
        match self {
            Op::Set { kind, server_id, .. } | Op::Remove { kind, server_id } => kind.slot(server_id),
        }
    }

    /// Вид секрета: часть ключа очереди.
    fn kind(&self) -> Kind {
        match self {
            Op::Set { kind, .. } | Op::Remove { kind, .. } => *kind,
        }
    }

    /// Сервер: часть ключа очереди.
    fn server_id(&self) -> &str {
        match self {
            Op::Set { server_id, .. } | Op::Remove { server_id, .. } => server_id,
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
/// Ключ — слот операции, а не порядок постановки: рендерер держит открытые
/// секреты в своём состоянии и присылает их с каждым сохранением конфига, то
/// есть между `stage` и `flush` один и тот же слот попадает в очередь снова и
/// снова. Без склейки каждое такое сохранение писало бы в Credential Manager
/// столько одинаковых записей, сколько секретов в конфиге.
///
/// Потеря очереди при аварийном завершении безопасна: вольт к этому моменту уже
/// записан и остаётся источником истины — недостающие записи восстановит
/// миграция следующего запуска.
fn pending() -> &'static Mutex<BTreeMap<(Kind, String), Op>> {
    static PENDING: OnceLock<Mutex<BTreeMap<(Kind, String), Op>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// Кладёт операцию в очередь. Вызывается из кода, который уже работает с
/// открытым секретом, — то есть в момент, когда значение ещё не забыто.
///
/// Повторная постановка того же слота заменяет предыдущую операцию: порядок
/// внутри окна между `stage` и `flush` не важен, важен только последний
/// результат, а он совпадает с содержимым вольта.
pub fn stage(op: Op) {
    if let Ok(mut queue) = pending().lock() {
        queue.insert((op.kind(), op.server_id().to_owned()), op);
    }
}

/// Забирает накопленные операции, очищая очередь.
pub fn take_pending() -> Vec<Op> {
    pending()
        .lock()
        .map(|mut queue| std::mem::take(&mut *queue).into_values().collect())
        .unwrap_or_default()
}

/// Переносит накопленные операции в системное хранилище в отдельном потоке.
///
/// Возвращает число применённых операций: неприменённые (нет хранилища, не
/// помещается значение) возвращаются в очередь не будут — вольт их уже хранит.
///
/// Записи сериализованы между собой. `save_config` приходит из IPC-обработчиков
/// параллельно, и два одновременных `flush` разбирали бы очередь независимо и
/// могли бы применить операции к одному слоту в обратном порядке — тогда в
/// хранилище остался бы не тот пароль. Тот же приём, что в
/// [`crate::config::save_async`].
pub async fn flush() -> usize {
    static FLUSH_QUEUE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let queue = FLUSH_QUEUE.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = queue.lock().await;

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

    // Блобы не копируются: перенос их только читает, а карта под замком не
    // меняется.
    for (secrets, kind) in [
        (config.encrypted_passwords.as_ref(), Kind::Password),
        (config.encrypted_key_passphrases.as_ref(), Kind::KeyPassphrase),
    ] {
        for (server_id, secret) in secrets.into_iter().flatten() {
            migrate_secret(&mut report, kind, server_id, secret);
        }
    }

    // Приватные ключи лежат не в отдельной карте, а внутри блока избранного, и
    // хранятся как `serde_json::Value`, поэтому разбираются здесь.
    for favorite in &config.favorites {
        let (Some(id), Some(secret)) = (favorite.id.as_deref(), favorite.private_key_secret()) else {
            continue;
        };
        migrate_secret(&mut report, Kind::PrivateKey, id, &secret);
    }

    report
}

/// Переносит один секрет и относит попытку к одному из четырёх исходов отчёта.
fn migrate_secret(report: &mut MigrationReport, kind: Kind, server_id: &str, secret: &EncryptedSecret) {
    let slot = kind.slot(server_id);
    if keychain::read_slot(&slot).is_some() {
        report.present += 1;
        return;
    }

    let Ok(value) = crate::vault::decrypt(secret) else {
        report.skipped += 1;
        return;
    };

    if keychain::write_slot(&slot, &value) {
        report.migrated += 1;
    } else {
        // Хранилище недоступно либо значение не помещается: секрет
        // остаётся в вольте, и это не повод ничего портить.
        report.too_large += 1;
    }
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
fn sample_secret(config: &AppConfig) -> Option<&EncryptedSecret> {
    config.encrypted_passwords.as_ref()?.values().next()
}

/// Серверы с запечатанным секретом каждого вида: «вид → id серверов».
///
/// Только идентификаторы: [`stage_removals`] вызывается на каждом сохранении
/// конфига, а [`clear_all_secrets`] работает по именам слотов, поэтому копировать
/// блобы ради них незачем. Приватный ключ отбирается по форме значения
/// ([`SshConfig::has_private_key_blob`]) — без клона `serde_json::Value` и разбора
/// JSON.
pub fn vault_secret_ids(config: &AppConfig) -> Vec<(Kind, Vec<&str>)> {
    // Отдельная функция, а не замыкание: замыкание не обобщается по времени
    // жизни и не дало бы вернуть ссылки на ключи конфига.
    fn ids(map: Option<&BTreeMap<String, EncryptedSecret>>) -> Vec<&str> {
        map.map(|map| map.keys().map(String::as_str).collect()).unwrap_or_default()
    }

    vec![
        (Kind::Password, ids(config.encrypted_passwords.as_ref())),
        (Kind::KeyPassphrase, ids(config.encrypted_key_passphrases.as_ref())),
        (
            Kind::PrivateKey,
            config
                .favorites
                .iter()
                .filter(|favorite| favorite.has_private_key_blob())
                .filter_map(|favorite| favorite.id.as_deref())
                .collect(),
        ),
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

    // Пока вольт открыт, его значение новее системного кэша: при неудачной
    // записи в Credential Manager там мог остаться прежний пароль. Не даём
    // такому кэшу перекрыть пароль, который только что сохранён в конфиге.
    if crate::vault::is_unlocked() {
        match from_vault() {
            Lookup::Found(value) => return Ok(Some(value)),
            Lookup::Broken => return Err("errors.vaultDecryptFailed".to_owned()),
            Lookup::Absent | Lookup::Locked => {}
        }
    }

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
    let next_ids: BTreeSet<&str> = next.favorites.iter().filter_map(|favorite| favorite.id.as_deref()).collect();

    for (kind, secrets) in vault_secret_ids(previous) {
        for server_id in secrets {
            if !next_ids.contains(server_id) {
                stage(Op::Remove { kind, server_id: server_id.to_owned() });
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
    for (kind, servers) in vault_secret_ids(config) {
        for server_id in servers {
            if keychain::delete_slot(&kind.slot(server_id)) {
                removed += 1;
            }
        }
    }
    removed
}

/// Полная очистка в отдельном потоке — для вызовов из `async`-команд.
///
/// Удаление одного слота — блокирующий IPC, а серверов в конфиге может быть
/// сколько угодно: без `spawn_blocking` вся очистка выполнялась бы на worker'е
/// tokio. Конфиг передаётся по владению, как в [`migrate_async`].
pub async fn clear_all_secrets_async(config: AppConfig) -> usize {
    tauri::async_runtime::spawn_blocking(move || clear_all_secrets(&config)).await.unwrap_or(0)
}

#[cfg(test)]
#[path = "tests/secrets.rs"]
mod tests;
