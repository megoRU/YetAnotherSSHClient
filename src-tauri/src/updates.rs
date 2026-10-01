//! Автообновление — порт `electron/src/update-service.ts`, построен на
//! `tauri-plugin-updater`.
//!
//! ## Почему обновление не может сломать запуск
//!
//! 1. **Подпись проверяется до установки.** Плагин проверяет minisign-подпись
//!    артефакта и отказывается ставить неподписанное. Неподписанный файл
//!    физически не может заменить установленное приложение.
//! 2. **Нужен корректный публичный ключ.** Пока в `tauri.conf.json` стоит
//!    placeholder, автообновление полностью выключено ([`is_updater_configured`]),
//!    а не «падает при попытке проверить подпись».
//! 3. **Предлагается только более новая версия.** Откат запрещён, сравнение
//!    версий — строгое (`>`), так что сборка «той же» версии обновление не
//!    предложит.
//! 4. **Автоустановки нет.** Обновление скачивается и ставится только по
//!    явному действию пользователя (`quit-and-install`); перезапуск вызывается
//!    исключительно после успешной установки.
//! 5. **Состояние хранится отдельно от конфига.** Файл
//!    `~/.minissh_updater.json` не участвует в бэкапах конфига и не может быть
//!    повреждён при импорте/экспорте настроек.
//! 6. **Ошибки не пробрасываются в UI как исключения.** Любая ошибка
//!    (сеть, манифест, подпись) превращается в статус `error`/`unavailable`;
//!    установленное приложение при этом не меняется.
//! 7. **«Предлагать нечего» — это не ошибка.** Манифест-заглушка отдаёт
//!    `version: 0.0.0` и пустой `platforms`, поэтому плагин возвращает
//!    `TargetNotFound`/`TargetsNotFound`. Это штатное «обновлений нет», и
//!    оно переводится в статус `not-available`, а не в `error`
//!    (см. [`is_no_update_error`]).
//!
//! ## Проверка без публикации релиза
//!
//! Endpoint можно переопределить переменной окружения `YASSH_UPDATER_ENDPOINT`.
//! Это позволяет поднять локальный HTTP-сервер с подписанным артефактом и
//! проверить полный цикл (проверка → скачивание → подпись → установка) на
//! чистой установке и при переходе со старой версии, не публикуя релиз.
//! Подробности — в `docs/UPDATER.md`.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

use crate::logger;
use crate::paths;

/// Публичный ключ-заглушка в `tauri.conf.json`. Пока он на месте, обновления
/// выключены: проверка подписи невозможна, и любая попытка обновиться
/// завершилась бы ошибкой.
const PUBKEY_PLACEHOLDER: &str = "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER";

/// Переопределение endpoint (для локальной проверки автообновления).
const ENDPOINT_ENV: &str = "YASSH_UPDATER_ENDPOINT";

/// Состояние проверки/установки обновлений.
pub struct UpdaterState {
    /// Скачанное обновление, ожидающее подтверждения установки.
    pending: Mutex<Option<Update>>,
    /// Версия, которую пользователь отклонил: повторно не предлагаем.
    skipped: Mutex<Option<String>>,
    /// Версия, о которой сообщили (чтобы не спамить событиями).
    notified: Mutex<Option<String>>,
    /// Метки времени последней проверки и установки.
    last_check: Mutex<Option<SystemTime>>,
    last_install: Mutex<Option<SystemTime>>,
}

impl UpdaterState {
    pub fn new() -> Self {
        UpdaterState {
            pending: Mutex::new(None),
            skipped: Mutex::new(None),
            notified: Mutex::new(None),
            last_check: Mutex::new(None),
            last_install: Mutex::new(None),
        }
    }

    pub async fn take_pending(&self) -> Option<Update> {
        self.pending.lock().await.take()
    }

    pub async fn set_pending(&self, update: Update) {
        *self.pending.lock().await = Some(update);
    }

    /// Версия подготовленного обновления — **без** извлечения из реестра.
    ///
    /// Нужна для проверок до `take_pending`: если обновление отброшено, оно
    /// обязано остаться подготовленным, иначе кнопка «обновить» перестанет
    /// работать до следующей проверки.
    pub async fn pending_version(&self) -> Option<String> {
        self.pending.lock().await.as_ref().map(|update| update.version.clone())
    }

    /// Отклонённая пользователем версия.
    ///
    /// Холодный старт: значение подхватывается из `~/.minissh_updater.json`,
    /// иначе после перезапуска «пропущенное» обновление снова предлагалось бы.
    pub async fn skipped_version(&self) -> Option<String> {
        if let Some(version) = self.skipped.lock().await.clone() {
            return Some(version);
        }
        let stored = read_state_file().skipped_version;
        *self.skipped.lock().await = stored.clone();
        stored
    }

    pub async fn set_skipped(&self, version: Option<String>) {
        *self.skipped.lock().await = version.clone();
        store_skipped_version(version);
    }

    /// Версия, о которой уже сообщили.
    ///
    /// Холодный старт: значение подхватывается из файла состояния, иначе после
    /// перезапуска `update-available` пришёл бы второй раз для той же версии —
    /// пользователь получил бы уведомление о том, что уже видел.
    pub async fn notified_version(&self) -> Option<String> {
        if let Some(version) = self.notified.lock().await.clone() {
            return Some(version);
        }
        let stored = read_state_file().notified_version;
        *self.notified.lock().await = stored.clone();
        stored
    }

    /// Помечает версию как «уже сообщённую» — в памяти и на диске.
    pub async fn set_notified(&self, version: &str) {
        *self.notified.lock().await = Some(version.to_owned());
        store_notified_version(version);
    }
}

impl Default for UpdaterState {
    fn default() -> Self {
        UpdaterState::new()
    }
}

// ── Состояние на диске ───────────────────────────────────────────────────────

/// Файл `~/.minissh_updater.json`.
///
/// Отдельный от `AppConfig` намеренно: бэкапы конфига остаются взаимозаменяемыми
/// с Electron-версией, а служебные метки времени не попадают в настройки.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterStateFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_check: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_download: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_install: Option<u64>,
    /// Версия, отклонённая пользователем.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skipped_version: Option<String>,
    /// Версия, о которой уже сообщили.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notified_version: Option<String>,
}

fn state_file_path() -> Option<PathBuf> {
    // Тесты работают с временным файлом, а не с настоящим состоянием
    // пользователя: файл в домашнем каталоге трогать нельзя.
    #[cfg(test)]
    if let Some(path) = test_state::current() {
        return Some(path);
    }
    paths::updater_state_path()
}

/// Подмена пути файла состояния — только для тестов.
///
/// Настоящий файл лежит в домашнем каталоге пользователя, поэтому тесты
/// перенаправляют его во временный: иначе они писали бы в реальные настройки
/// и зависели бы от прошлых запусков приложения.
#[cfg(test)]
mod test_state {
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard};

    static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
    /// Сериализует тесты: путь файла состояния — общий на весь процесс, и без
    /// блокировки соседний тест перенаправил бы его на свой файл.
    static LOCK: Mutex<()> = Mutex::new(());

    pub fn current() -> Option<PathBuf> {
        PATH.lock().ok()?.clone()
    }

    fn set(path: Option<PathBuf>) {
        if let Ok(mut slot) = PATH.lock() {
            *slot = path;
        }
    }

    /// Guard, восстанавливающий исходный путь и отпускающий блокировку.
    pub struct Restore {
        _lock: MutexGuard<'static, ()>,
        previous: Option<PathBuf>,
    }

    impl Drop for Restore {
        fn drop(&mut self) {
            set(self.previous.take());
        }
    }

    /// Перенаправляет файл состояния автообновления в `path` до конца теста.
    pub fn use_file(path: PathBuf) -> Restore {
        let lock = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = current();
        set(Some(path));
        Restore { _lock: lock, previous }
    }
}

fn read_state_file() -> UpdaterStateFile {
    let Some(path) = state_file_path() else { return UpdaterStateFile::default() };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_state_file(state: &UpdaterStateFile) -> Result<(), String> {
    let Some(path) = state_file_path() else { return Ok(()) };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(state).map_err(|err| err.to_string())?;
    std::fs::write(&path, text).map_err(|err| err.to_string())
}

/// Сохраняет отклонённую версию.
///
/// Запись переписывает файл целиком, но он предварительно читается, поэтому
/// метки времени (`lastCheck` и прочие) при этом не теряются.
fn store_skipped_version(version: Option<String>) {
    let mut file = read_state_file();
    if file.skipped_version == version {
        return;
    }
    file.skipped_version = version;
    let _ = write_state_file(&file);
}

/// Сохраняет версию, о которой уже сообщили: после перезапуска `update-available`
/// для неё повторно не отправляется.
fn store_notified_version(version: &str) {
    let mut file = read_state_file();
    if file.notified_version.as_deref() == Some(version) {
        return;
    }
    file.notified_version = Some(version.to_owned());
    let _ = write_state_file(&file);
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

// ── Конфигурация ─────────────────────────────────────────────────────────────

/// Текущая версия приложения (из `Cargo.toml`).
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Сконфигурировано ли автообновление.
///
/// `false` ⇒ UI показывает «обновление недоступно», и обновление не
/// предпринимается вовсе. Это защищает сборки без ключа подписи.
pub fn is_updater_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins.0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(Value::as_str)
        .map(|pubkey| !pubkey.is_empty() && !pubkey.contains(PUBKEY_PLACEHOLDER))
        .unwrap_or(false)
}

/// Endpoint манифеста: из конфига, с переопределением через окружение.
pub fn endpoint(app: &AppHandle) -> Option<String> {
    if let Ok(value) = std::env::var(ENDPOINT_ENV) {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_owned());
        }
    }
    app.config()
        .plugins.0
        .get("updater")
        .and_then(|config| config.get("endpoints"))
        .and_then(Value::as_array)
        .and_then(|endpoints| endpoints.first())
        .and_then(Value::as_str)
        .map(str::to_owned)
}

// ── Статусы и события ────────────────────────────────────────────────────────

/// Статус автообновления (совпадает с `UpdateStatus` на frontend).
pub const STATUS_IDLE: &str = "idle";
pub const STATUS_CHECKING: &str = "checking";
pub const STATUS_AVAILABLE: &str = "available";
pub const STATUS_NOT_AVAILABLE: &str = "not-available";
pub const STATUS_DOWNLOADING: &str = "downloading";
pub const STATUS_DOWNLOADED: &str = "downloaded";
pub const STATUS_INSTALLING: &str = "installing";
pub const STATUS_ERROR: &str = "error";

pub fn emit_status(app: &AppHandle, status: &str) {
    let _ = app.emit("update-status", status);
}

pub fn emit_error(app: &AppHandle, error: &str) {
    logger::error("Updater", error);
    let _ = app.emit("update-error", error);
}

/// Информация о доступном обновлении (`UpdateInfo` на frontend).
#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "releaseNotes", skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
}

/// Прогресс загрузки обновления (`UpdateProgress` на frontend).
#[derive(Debug, Clone, Serialize)]
pub struct UpdateProgress {
    pub bytes_per_second: u64,
    pub percent: u32,
    pub total: u64,
    pub transferred: u64,
}

/// Результат проверки обновлений (`CheckUpdateResult` на frontend).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateResult {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "releaseNotes", skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Сравнение semver-подобных версий: `true`, если `left` новее `right`.
///
/// Осознанно упрощённое сравнение: префикс `v` игнорируется, недостающие
/// числовые сегменты считаются нулями. Пре-релизная сборка младше релиза с тем
/// же номером (`4.0.0` > `4.0.0-rc.1`), а между собой пре-релизы сравниваются
/// по semver: `rc.2` новее `rc.1`, `rc.1` новее `beta`.
///
/// Нераспознанная версия (не числа, больше четырёх сегментов) не считается
/// новой: иначе битый манифест предложил бы «обновление» до мусора.
pub fn is_newer_version(left: &str, right: &str) -> bool {
    /// Разбор версии: числовые сегменты и идентификаторы пре-релиза.
    fn parse(value: &str) -> Option<(Vec<u64>, Vec<String>)> {
        let trimmed = value.trim().trim_start_matches(['v', 'V']);
        let core = trimmed.split('+').next().unwrap_or(trimmed);
        let (core, pre_release) = match core.split_once('-') {
            Some((core, pre_release)) => (core, pre_release),
            None => (core, ""),
        };

        let raw: Vec<&str> = core.split('.').collect();
        if raw.is_empty() || raw.len() > 4 {
            return None;
        }
        let mut segments = Vec::with_capacity(3);
        for segment in &raw {
            segments.push(segment.trim().parse::<u64>().ok()?);
        }
        while segments.len() < 3 {
            segments.push(0);
        }

        let pre: Vec<String> = if pre_release.is_empty() {
            Vec::new()
        } else {
            pre_release.split('.').map(|part| part.trim().to_owned()).collect()
        };
        Some((segments, pre))
    }

    /// Сравнение идентификаторов пре-релиза по правилам semver.
    fn compare_pre_release(left: &[String], right: &[String]) -> std::cmp::Ordering {
        use std::cmp::Ordering;
        // Отсутствие пре-релиза означает релиз, он новее любой пре-версии.
        match (left.is_empty(), right.is_empty()) {
            (true, true) => return Ordering::Equal,
            (true, false) => return Ordering::Greater,
            (false, true) => return Ordering::Less,
            (false, false) => {}
        }
        for (left_part, right_part) in left.iter().zip(right.iter()) {
            let ordering = match (left_part.parse::<u64>(), right_part.parse::<u64>()) {
                (Ok(left_number), Ok(right_number)) => left_number.cmp(&right_number),
                // Числовые идентификаторы младше буквенных (`alpha` < `1`).
                (Ok(_), Err(_)) => Ordering::Less,
                (Err(_), Ok(_)) => Ordering::Greater,
                (Err(_), Err(_)) => left_part.cmp(right_part),
            };
            if ordering != Ordering::Equal {
                return ordering;
            }
        }
        // Одинаковый префикс: версия с большим числом идентификаторов новее.
        left.len().cmp(&right.len())
    }

    let Some((left_segments, left_pre)) = parse(left) else { return false };
    let Some((right_segments, right_pre)) = parse(right) else { return false };

    if left_segments != right_segments {
        return left_segments > right_segments;
    }
    compare_pre_release(&left_pre, &right_pre) == std::cmp::Ordering::Greater
}

// ── Основные операции ────────────────────────────────────────────────────────

/// Проверяет наличие обновления.
///
/// Никогда не выдаёт ошибку наружу как исключение: неудачная проверка —
/// это `error` в результате, а не падение. Приложение продолжает работать на
/// текущей версии.
pub async fn check(app: &AppHandle, state: &UpdaterState) -> CheckUpdateResult {
    emit_status(app, STATUS_CHECKING);

    if !is_updater_configured(app) {
        emit_status(app, STATUS_NOT_AVAILABLE);
        return CheckUpdateResult {
            available: false,
            version: None,
            url: None,
            release_notes: None,
            error: None,
        };
    }

    let update = match fetch_update(app).await {
        Ok(update) => update,
        Err(message) => {
            emit_error(app, &message);
            emit_status(app, STATUS_ERROR);
            return CheckUpdateResult {
                available: false,
                version: None,
                url: None,
                release_notes: None,
                error: Some(message),
            };
        }
    };

    let Some(update) = update else {
        emit_status(app, STATUS_NOT_AVAILABLE);
        return CheckUpdateResult {
            available: false,
            version: None,
            url: None,
            release_notes: None,
            error: None,
        };
    };

    // Отклонённая версия больше не предлагается, но проверка считается успешной.
    if state.skipped_version().await.as_deref() == Some(update.version.as_str()) {
        emit_status(app, STATUS_NOT_AVAILABLE);
        return CheckUpdateResult {
            available: false,
            version: Some(update.version.clone()),
            url: None,
            release_notes: update.body.clone(),
            error: None,
        };
    }

    let info = UpdateInfo {
        version: update.version.clone(),
        url: Some(update.download_url.to_string()),
        release_notes: update.body.clone(),
    };
    state.set_pending(update).await;

    // Одно уведомление на версию: иначе событие повторялось бы на каждой
    // фоновой проверке, а после перезапуска — снова. Метка хранится в файле
    // состояния, поэтому переживает холодный старт.
    if state.notified_version().await.as_deref() != Some(info.version.as_str()) {
        state.set_notified(&info.version).await;
        let _ = app.emit("update-available", &info);
    }
    emit_status(app, STATUS_AVAILABLE);

    CheckUpdateResult {
        available: true,
        version: Some(info.version),
        url: info.url,
        release_notes: info.release_notes,
        error: None,
    }
}

/// Ошибка плагина, означающая «обновлять нечего», а не сбой.
///
/// `tauri-plugin-updater` ищет платформу (`windows-x86_64`) в объекте
/// `platforms` манифеста **до** того, как сравнить версии, поэтому пустой
/// `platforms` даёт `TargetNotFound`/`TargetsNotFound` даже при заведомо
/// меньшей версии. Для приложения это то же состояние, что и «обновлений нет»:
/// показывать пользователю ошибку не о чем — скачивать всё равно нечего.
///
/// `ReleaseNotFound` сюда не входит: это битый или недоступный endpoint,
/// о нём пользователю сказать полезно.
pub fn is_no_update_error(error: &tauri_plugin_updater::Error) -> bool {
    matches!(
        error,
        tauri_plugin_updater::Error::TargetNotFound(_) | tauri_plugin_updater::Error::TargetsNotFound(_)
    )
}

async fn fetch_update(app: &AppHandle) -> Result<Option<Update>, String> {
    let mut builder = app.updater_builder();
    if let Some(endpoint) = endpoint(app) {
        let endpoint = endpoint.parse::<tauri::Url>().map_err(|error| error.to_string())?;
        builder = builder
            .endpoints(vec![endpoint])
            .map_err(|error| error.to_string())?;
    }
    let updater = builder.build().map_err(|error| error.to_string())?;
    match updater.check().await {
        Ok(update) => Ok(update),
        // «Платформы в манифесте нет» = «обновлений нет»: не ошибка.
        Err(error) if is_no_update_error(&error) => {
            logger::debug("Updater", "manifest has no artifact for this platform — no update offered");
            Ok(None)
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Скачивает и проверяет подпись найденного обновления.
///
/// Возвращает список файлов-ошибок (пустой при успехе) — формат ответа
/// совпадает с `DownloadUpdateResult` (`string[]`) в Electron-версии.
pub async fn start_download(app: &AppHandle, state: &UpdaterState) -> Vec<String> {
    if !is_updater_configured(app) {
        return vec!["Автообновление не настроено: не задан публичный ключ подписи".to_owned()];
    }

    // Версия проверяется **до** извлечения: `take_pending` забирает обновление
    // безвозвратно, и отказ по откату оставил бы кнопку «обновить» мёртвой до
    // следующей проверки.
    let Some(version) = state.pending_version().await else {
        return vec!["Нет подготовленного обновления".to_owned()];
    };

    if !is_newer_version(&version, CURRENT_VERSION) {
        // Защита от отката: «обновление» на ту же или более старую версию
        // отбрасывается, установленное приложение не трогаем.
        return vec![format!(
            "Обновление {version} не новее установленной версии {CURRENT_VERSION}"
        )];
    }

    let Some(update) = state.take_pending().await else {
        return vec!["Нет подготовленного обновления".to_owned()];
    };

    emit_status(app, STATUS_DOWNLOADING);

    let mut downloaded = 0u64;
    let mut total = 0u64;
    let started = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now() - Duration::from_secs(1);

    let app_handle = app.clone();
    let result = update
        .download_and_install(
            move |chunk, length| {
                downloaded = downloaded.saturating_add(chunk as u64);
                total = length.unwrap_or(total).max(downloaded);
                let now = std::time::Instant::now();
                if now.duration_since(last_emit) >= Duration::from_millis(200) {
                    last_emit = now;
                    let elapsed = started.elapsed().as_secs_f64().max(0.001);
                    let percent = if total > 0 {
                        ((downloaded as f64 / total as f64) * 100.0).round().min(100.0) as u32
                    } else {
                        0
                    };
                    let _ = app_handle.emit(
                        "update-progress",
                        UpdateProgress {
                            bytes_per_second: (downloaded as f64 / elapsed) as u64,
                            percent,
                            total,
                            transferred: downloaded,
                        },
                    );
                }
            },
            move || {
                let _ = app.emit("update-downloaded", ());
            },
        )
        .await;

    match result {
        Ok(()) => {
            // Установка завершилась: плагин уже заменил файлы приложения.
            let mut file = read_state_file();
            file.last_download = Some(now_millis());
            file.last_install = Some(now_millis());
            let _ = write_state_file(&file);
            state.set_last_install();

            emit_status(app, STATUS_DOWNLOADED);
            Vec::new()
        }
        Err(err) => {
            // Установка не началась: подпись не совпала или загрузка оборвалась.
            // Установленное приложение не изменено.
            let message = err.to_string();
            logger::error("Updater", &format!("Update install failed, current build kept: {message}"));
            emit_error(app, &message);
            emit_status(app, STATUS_ERROR);
            vec![message]
        }
    }
}

/// Устанавливает скачанное обновление и перезапускает приложение.
///
/// Вызывается только из `quit-and-install`, то есть по явному действию
/// пользователя. Перезапуск происходит лишь после успешной установки.
pub fn quit_and_install(app: &AppHandle) {
    if !is_updater_configured(app) {
        logger::warn("Updater", "quit-and-install ignored: updater is not configured");
        return;
    }
    emit_status(app, STATUS_INSTALLING);
    logger::info("Updater", "Restarting application to finish update");
    app.restart();
}

/// Проверяет, можно ли запускать фоновую проверку (защита от спама).
pub fn should_check(state: &UpdaterState, min_interval: Duration) -> bool {
    match state.last_check.try_lock() {
        Ok(guard) => guard
            .as_ref()
            .map(|value| value.elapsed().map(|elapsed| elapsed >= min_interval).unwrap_or(false))
            .unwrap_or(true),
        Err(_) => false,
    }
}

pub fn set_last_check(state: &UpdaterState) {
    if let Ok(mut guard) = state.last_check.try_lock() {
        *guard = Some(SystemTime::now());
    }
    let mut file = read_state_file();
    file.last_check = Some(now_millis());
    let _ = write_state_file(&file);
}

impl UpdaterState {
    /// Фиксирует факт установки обновления.
    pub fn set_last_install(&self) {
        if let Ok(mut guard) = self.last_install.try_lock() {
            *guard = Some(SystemTime::now());
        }
    }
}

/// Метки времени последней проверки/загрузки/установки (для диагностики).
pub fn state_snapshot() -> Value {
    let file = read_state_file();
    serde_json::to_value(&file).unwrap_or(Value::Null)
}

#[cfg(test)]
#[path = "tests/updates.rs"]
mod tests;
