//! Системное хранилище: ключ восстановления и, сами
//! секреты.
//!
//! Electron использовал `safeStorage` (DPAPI / Keychain / libsecret).
//! В Tauri своего аналога нет, поэтому записи кладутся в системное хранилище
//! учётных данных через `keyring`:
//!
//! * Windows — Credential Manager;
//! * macOS — Keychain;
//! * Linux — Secret Service (тот же backend, что и у Electron).
//!
//! # Две разные вещи в одном модуле
//!
//! 1. **Ключ восстановления** — слот [`Slot::RecoveryKey`]. Нужен для показа и
//!    для аварийного открытия старого вольта. Лежит под именем, которое уже
//!    заведено в боевых установках, поэтому переименование слотов его бы
//!    затёрло.
//! 2. **Секреты по одному на сервер** — слоты [`Slot::Password`],
//!    [`Slot::KeyPassphrase`], [`Slot::PrivateKey`]. Читаются при подключении,
//!    без вывода мастер-ключа и без `scrypt`.
//!
//! # Мягкая деградация
//!
//! Если хранилище недоступно (нет secret service, сборка
//! `--no-default-features`, запись не помещается в лимит платформы), функции
//! возвращают `false`/`None`. Приложение продолжает работать через старый
//! encrypted vault — ровно то поведение, которое было у Electron при
//! недоступном `safeStorage`.
//!
//! # Тестируемость
//!
//! Вместо прямых вызовов `keyring` модуль ходит через трейт [`SecretBackend`].
//! Тесты подменяют backend на [`MemoryBackend`] — политику дублирования и
//! миграции можно проверять на любой ОС, не трогая настоящее системное
//! хранилище пользователя.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
// `OnceLock` нужен подмене backend'а (только тесты) и системному хранилищу:
// в сборке `--no-default-features` без тестов не используется.
#[cfg(any(test, feature = "keychain"))]
use std::sync::OnceLock;

#[allow(unused_imports)]
use crate::paths;

/// Метка «в хранилище лежит маркер, а не ключ».
const CACHE_MARKER: &str = "keychain";

/// Префикс имён слотов с секретами.
///
/// Отдельный от [`paths::KEYCHAIN_USER`], чтобы перечисление слотов секретов
/// никогда не выдавало слот ключа восстановления.
const SECRET_PREFIX: &str = "secret";

/// Максимальный размер значения, которое система гарантированно примет.
///
/// Ограничение задаёт Credential Manager: `CRED_MAX_CREDENTIAL_BLOB_SIZE`
/// равен 2560 байтам, поэтому 2400 байт — с запасом на заголовок и на
/// разные единицы счёта в разных API. Keychain и Secret Service ограничений
/// жёстче не имеют, но единый предел нужен, чтобы поведение не зависело от
/// платформы.
///
/// Секреты крупнее остаются только в encrypted vault: подключение к такому
/// серверу идёт через вольт, как и раньше.
pub const MAX_SYSTEM_SECRET_BYTES: usize = 2400;

/// Слот системного хранилища: одна запись одного секрета.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Slot {
    /// Ключ восстановления вольта.
    RecoveryKey,
    /// Пароль сервера.
    Password(String),
    /// Парольная фраза приватного ключа сервера.
    KeyPassphrase(String),
    /// Приватный ключ сервера.
    PrivateKey(String),
}

impl Slot {
    /// Имя записи в хранилище (то, что `keyring` называет user/account).
    ///
    /// Имя слота ключа восстановления не меняется: у пользователей оно уже
    /// заведено в системном хранилище, и переименование заставило бы всех
    /// заново вводить ключ вручную.
    pub fn account(&self) -> String {
        match self {
            Slot::RecoveryKey => paths::KEYCHAIN_USER.to_owned(),
            Slot::Password(id) => format!("{SECRET_PREFIX}:password:{id}"),
            Slot::KeyPassphrase(id) => format!("{SECRET_PREFIX}:key-passphrase:{id}"),
            Slot::PrivateKey(id) => format!("{SECRET_PREFIX}:private-key:{id}"),
        }
    }

    /// Защищён ли слот лимитом на размер значения.
    ///
    /// На ключ восстановления предел не действует: он короткий, и его не
    /// записывать нельзя — иначе авторазблокировка не сработает.
    pub fn has_size_limit(&self) -> bool {
        !matches!(self, Slot::RecoveryKey)
    }

    /// Помещается ли значение в этот слот.
    pub fn accepts(&self, value: &str) -> bool {
        !self.has_size_limit() || value.len() <= MAX_SYSTEM_SECRET_BYTES
    }
}

// ── Backend ───────────────────────────────────────────────────────────────────

/// Хранилище, умеющее читать, писать и удалять записи по (service, account).
///
/// Трейт нужен не для красоты: без него тесты политики миграции вынуждены были
/// бы ходить в настоящее хранилище ОС, где у разработчика может не оказаться
/// secret service, а на Windows — Credential Manager с записью тестов.
pub trait SecretBackend: Send + Sync {
    fn read(&self, service: &str, account: &str) -> Result<Option<String>, String>;
    fn write(&self, service: &str, account: &str, value: &str) -> Result<(), String>;
    fn delete(&self, service: &str, account: &str) -> Result<(), String>;
}

/// Реальный backend поверх `keyring`.
#[cfg(feature = "keychain")]
struct KeyringBackend;

#[cfg(feature = "keychain")]
impl SecretBackend for KeyringBackend {
    fn read(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(service, account).map_err(|err| err.to_string())?;
        match entry.get_password() {
            Ok(value) if !value.is_empty() && value != CACHE_MARKER => Ok(Some(value)),
            Ok(_) => Ok(None),
            // Записи нет — это не ошибка хранилища.
            Err(_) => Ok(None),
        }
    }

    fn write(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, account).map_err(|err| err.to_string())?;
        entry.set_password(value).map_err(|err| err.to_string())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, account).map_err(|err| err.to_string())?;
        match entry.delete_credential() {
            // Записи нет — это и есть желаемое состояние после удаления.
            // Без этой ветки каждое удаление отсутствующего секрета писало бы в
            // лог «No matching credential found»: при пустых паролях в конфиге
            // таких попыток на каждый сервер при каждом сохранении.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
            Ok(()) => Ok(()),
        }
    }
}

/// Backend в памяти: тесты и сборка `--no-default-features`.
///
/// Во втором случае он же служит признаком «системного хранилища нет»: пустая
/// память даёт ровно то поведение, что и недоступный keyring, — чтение
/// возвращает `None`, запись сообщает об ошибке.
pub struct MemoryBackend {
    entries: Mutex<BTreeMap<(String, String), String>>,
}

impl Default for MemoryBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryBackend {
    pub fn new() -> Self {
        MemoryBackend { entries: Mutex::new(BTreeMap::new()) }
    }

    /// Сколько записей лежит в хранилище: тестам нужно знать, что запись
    /// действительно появилась, а не что вызов вернул `true`.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.lock().map(|entries| entries.len()).unwrap_or(0)
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl SecretBackend for MemoryBackend {
    fn read(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        let guard = self.entries.lock().map_err(|err| err.to_string())?;
        Ok(guard.get(&(service.to_owned(), account.to_owned())).cloned())
    }

    fn write(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
        if value.is_empty() || value == CACHE_MARKER {
            return Err("refusing to store an empty value or a marker".to_owned());
        }
        let mut guard = self.entries.lock().map_err(|err| err.to_string())?;
        guard.insert((service.to_owned(), account.to_owned()), value.to_owned());
        Ok(())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        let mut guard = self.entries.lock().map_err(|err| err.to_string())?;
        guard.remove(&(service.to_owned(), account.to_owned()));
        Ok(())
    }
}

/// Подмена backend. `None` — использовать настоящее системное хранилище.
#[cfg(test)]
fn backend_slot() -> &'static Mutex<Option<Arc<dyn SecretBackend>>> {
    static BACKEND: OnceLock<Mutex<Option<Arc<dyn SecretBackend>>>> = OnceLock::new();
    BACKEND.get_or_init(|| Mutex::new(None))
}

/// Подменяет системное хранилище. Только для тестов.
#[cfg(test)]
pub(crate) fn set_backend(backend: Arc<dyn SecretBackend>) {
    if let Ok(mut guard) = backend_slot().lock() {
        *guard = Some(backend);
    }
}

/// Возвращает подменённый backend, если он установлен.
#[cfg(test)]
fn overridden_backend() -> Option<Arc<dyn SecretBackend>> {
    backend_slot().lock().ok().and_then(|guard| guard.clone())
}

/// Настоящее системное хранилище — один раз на процесс.
///
/// `KeyringBackend` не имеет состояния, поэтому [`Arc`] на каждое обращение к
/// слоту был чистой накладной: чтение пароля на пути подключения шло через
/// `active_backend()`.
#[cfg(feature = "keychain")]
fn system_backend() -> Option<Arc<dyn SecretBackend>> {
    static SYSTEM: OnceLock<Arc<dyn SecretBackend>> = OnceLock::new();
    Some(SYSTEM.get_or_init(|| Arc::new(KeyringBackend)).clone())
}

/// Рабочий backend: подмена из тестов, иначе — настоящее хранилище, если оно
/// собрано.
///
/// Проверка подмены живёт под `#[cfg(test)]`: в релизной сборке она всегда
/// даёт `None`, а значит process-wide мьютекс и `Option<Arc>` на каждом
/// чтении и записи слота были не нужны.
fn active_backend() -> Option<Arc<dyn SecretBackend>> {
    #[cfg(test)]
    if let Some(backend) = overridden_backend() {
        return Some(backend);
    }
    #[cfg(feature = "keychain")]
    {
        system_backend()
    }
    #[cfg(not(feature = "keychain"))]
    {
        None
    }
}

/// Имя сервиса, в котором лежат слоты.
pub(crate) fn service() -> &'static str {
    #[cfg(test)]
    {
        TEST_SERVICE
    }
    #[cfg(not(test))]
    {
        paths::KEYCHAIN_SERVICE
    }
}

/// Сервис и пользователь для тестовых записей.
///
/// Тесты обязаны работать с отдельным сервисом: тесты работали с боевой
/// `com.yash.client` и вызывали `delete_recovery_key()`, стирая настоящий ключ
/// восстановления пользователя. После любого `cargo test` приложение снова
/// спрашивало ключ, хотя данные были целы. Общая запись — это не «грязный
/// тест», а уничтожение пользовательских данных.
///
/// Достаточно одного сервиса: имя слота ключа восстановления
/// ([`paths::KEYCHAIN_USER`]) остаётся настоящим и в тестах, чтобы тесты
/// проверяли тот же путь записи, что и у пользователя. Изоляцию обеспечивает
/// сервис, поэтому отдельного тестового имени слота не существует.
#[cfg(test)]
pub(crate) const TEST_SERVICE: &str = "com.yash.client.test";

// ── Публичные операции над слотами ────────────────────────────────────────────

/// Читает слот. `None` — записи нет либо хранилище недоступно.
pub fn read_slot(slot: &Slot) -> Option<String> {
    let backend = active_backend()?;
    let service = service();
    match backend.read(service, &slot.account()) {
        Ok(value) => value,
        Err(err) => {
            crate::logger::debug("Vault", &format!("System store read failed: {err}"));
            None
        }
    }
}

/// Пишет слот. `false` — хранилище недоступно или значение не помещается.
pub fn write_slot(slot: &Slot, value: &str) -> bool {
    if !slot.accepts(value) {
        crate::logger::warn(
            "Vault",
            &format!("Secret for {} exceeds the system store limit ({MAX_SYSTEM_SECRET_BYTES} bytes)", slot.account()),
        );
        return false;
    }
    let Some(backend) = active_backend() else {
        crate::logger::debug("Vault", "System store unavailable at build time");
        return false;
    };
    match backend.write(service(), &slot.account(), value) {
        Ok(()) => true,
        Err(err) => {
            crate::logger::warn("Vault", &format!("System store write failed: {err}"));
            false
        }
    }
}

/// Удаляет слот. `false` — хранилище недоступно.
pub fn delete_slot(slot: &Slot) -> bool {
    let Some(backend) = active_backend() else { return false };
    match backend.delete(service(), &slot.account()) {
        Ok(()) => true,
        Err(err) => {
            crate::logger::debug("Vault", &format!("System store delete failed: {err}"));
            false
        }
    }
}

// ── Ключ восстановления ───────────────────────────────────────────────────────

/// Есть ли в системном хранилище ключ восстановления.
pub fn has_recovery_key() -> bool {
    load_recovery_key().is_some()
}

#[cfg(feature = "keychain")]
pub fn load_recovery_key() -> Option<String> {
    read_slot(&Slot::RecoveryKey)
}

#[cfg(not(feature = "keychain"))]
pub fn load_recovery_key() -> Option<String> {
    crate::logger::debug("Vault", "System store disabled at build time; recovery key must be entered manually");
    None
}

#[cfg(feature = "keychain")]
pub fn store_recovery_key(recovery_key: &str) -> bool {
    write_slot(&Slot::RecoveryKey, recovery_key)
}

#[cfg(feature = "keychain")]
pub fn delete_recovery_key() -> bool {
    delete_slot(&Slot::RecoveryKey)
}

#[cfg(not(feature = "keychain"))]
pub fn store_recovery_key(_recovery_key: &str) -> bool {
    false
}

#[cfg(not(feature = "keychain"))]
pub fn delete_recovery_key() -> bool {
    false
}

/// Асинхронное чтение ключа восстановления.
///
/// Обращение к системному хранилищу (Windows Credential Manager, macOS
/// Keychain, Secret Service) — блокирующая операция: на Windows это IPC,
/// на Linux — поход в D-Bus. Вызов из `async fn` без `spawn_blocking` занимал
/// бы worker-поток tokio на всё время ожидания, а чтение выполняется на
/// каждом авторазблокировании.
pub async fn load_recovery_key_async() -> Option<String> {
    tauri::async_runtime::spawn_blocking(load_recovery_key)
        .await
        .ok()
        .flatten()
}

/// Значение, которое кладём в `AppConfig.cachedRecoveryKey`.
///
/// Это маркер, а не сам ключ: так поле сохраняет смысл «кэш есть», но не
/// раскрывает секрет тому, кто прочитал файл конфига.
pub const fn cache_marker() -> &'static str {
    CACHE_MARKER
}

/// Убирает ключ из системного хранилища.
pub fn clear_cached_recovery_key() {
    delete_recovery_key();
}

/// Читает секрет по слоту в отдельном потоке: нужен путь подключения, где
/// вызывающий код синхронный, а обращение к хранилищу блокирует.
pub async fn read_slot_async(slot: Slot) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || read_slot(&slot))
        .await
        .ok()
        .flatten()
}

/// Пишет секрет по слоту в отдельном потоке.
pub async fn write_slot_async(slot: Slot, value: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || write_slot(&slot, &value))
        .await
        .unwrap_or(false)
}

#[cfg(test)]
#[path = "tests/keychain.rs"]
mod tests;
