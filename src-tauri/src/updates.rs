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
//! 3. **Предлагается только более новая версия.** Откат запрещён, а версия
//!    сверяется ещё и перед установкой (см. [`is_rollback`]).
//! 4. **Автоустановки нет.** Скачивание и установка — разные команды, обе
//!    запускаются только по явному действию пользователя; перезапуск вызывается
//!    исключительно после успешной установки.
//! 5. **Состояние хранится в конфиге, а не в отдельном файле.** Метки проверки
//!    и пропущенные версии лежат в `AppConfig.updater`, поэтому бэкап настроек
//!    содержит их целиком.
//! 6. **Ошибки не пробрасываются в UI как исключения.** Любая ошибка
//!    (сеть, манифест, подпись) превращается в статус `error`/`unavailable`;
//!    установленное приложение при этом не меняется.
//! 7. **«Предлагать нечего» — это не ошибка.** Манифест может не содержать
//!    артефакта под текущую платформу, поэтому плагин возвращает
//!    `TargetNotFound`/`TargetsNotFound`. Это штатное «обновлений нет», и оно
//!    переводится в статус `not-available`, а не в `error`
//!    (см. [`is_no_update_error`]).
//!
//! ## Проверка без публикации релиза
//!
//! Endpoint можно переопределить переменной окружения `YASSH_UPDATER_ENDPOINT`.
//! Это позволяет поднять локальный HTTP-сервер с подписанным артефактом и
//! проверить полный цикл (проверка → скачивание → подпись → установка) на
//! чистой установке и при переходе со старой версии, не публикуя релиз.
//! Подробности — в `docs/UPDATER.md`.
//!
//! ## Один манифест и переключатель pre-release
//!
//! Манифест один: `latest.json`, приложенный к последнему релизу. Отдельного
//! манифеста pre-release нет намеренно — плагин всё равно не умеет отсекать
//! пре-релизы и отдал бы первую ответившую запись. Фильтрует само приложение:
//! выключенная настройка «Получать обновления Pre-release» заставляет
//! [`check`] отбросить версию с пре-релизом. Проверка выполняется дважды — при
//! поиске обновления и перед скачиванием, — чтобы уже найденный pre-release не
//! поставился после того, как пользователь выключил настройку.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

use crate::config::UpdaterConfig;
use crate::logger;

/// Публичный ключ-заглушка в `tauri.conf.json`. Пока он на месте, обновления
/// выключены: проверка подписи невозможна, и любая попытка обновиться
/// завершилась бы ошибкой.
const PUBKEY_PLACEHOLDER: &str = "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER";

/// Переопределение endpoint (для локальной проверки автообновления).
const ENDPOINT_ENV: &str = "YASSH_UPDATER_ENDPOINT";

/// Ключ списка endpoint'ов в `plugins.updater`.
const ENDPOINTS_KEY: &str = "endpoints";

/// Текущая версия приложения (из `Cargo.toml`).
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Состояние проверки/установки обновлений.
///
/// В памяти держится только то, что нужно для текущего процесса (готовое
/// обновление, файл установщика, последние метки времени). Всё, что должно
/// пережить перезапуск, лежит в конфиге — см. [`crate::config::UpdaterConfig`].
pub struct UpdaterState {
    /// Найденное обновление и, после скачивания, файл установщика.
    pending: Mutex<Option<Pending>>,
    /// Версия, которую пользователь отклонил: повторно не предлагаем.
    skipped: Mutex<Option<String>>,
    /// Версия, о которой сообщили (чтобы не спамить событиями).
    notified: Mutex<Option<String>>,
    /// Метки времени последней проверки, скачивания и установки.
    last_check: Mutex<Option<SystemTime>>,
    last_download: Mutex<Option<SystemTime>>,
    last_install: Mutex<Option<SystemTime>>,
}

/// Найденное обновление и скачанный установщик.
struct Pending {
    update: Update,
    installer: Option<Vec<u8>>,
}

impl UpdaterState {
    pub fn new() -> Self {
        UpdaterState {
            pending: Mutex::new(None),
            skipped: Mutex::new(None),
            notified: Mutex::new(None),
            last_check: Mutex::new(None),
            last_download: Mutex::new(None),
            last_install: Mutex::new(None),
        }
    }

    /// Версия подготовленного обновления — **без** извлечения из состояния.
    ///
    /// Нужна для проверок до [`UpdaterState::installer`]: если обновление
    /// отброшено, оно обязано остаться подготовленным, иначе кнопка
    /// «обновить» перестанет работать до следующей проверки.
    pub async fn pending_version(&self) -> Option<String> {
        self.pending.lock().await.as_ref().map(|pending| pending.update.version.clone())
    }

    pub async fn set_pending(&self, update: Update) {
        *self.pending.lock().await = Some(Pending {
            update,
            installer: None,
        });
    }

    /// Клон подготовленного обновления для скачивания.
    ///
    /// Именно клон, а не извлечение: оборванная загрузка не должна лишать
    /// пользователя кнопки «обновить» до следующей проверки.
    pub async fn pending_update(&self) -> Option<Update> {
        self.pending.lock().await.as_ref().map(|pending| pending.update.clone())
    }

    /// Сохраняет скачанный установщик для последующей установки.
    pub async fn set_installer(&self, installer: Vec<u8>) {
        if let Some(pending) = self.pending.lock().await.as_mut() {
            pending.installer = Some(installer);
        }
    }

    /// Отклонённая пользователем версия.
    ///
    /// Холодный старт: значение подхватывается из конфига, иначе после
    /// перезапуска «пропущенное» обновление снова предлагалось бы.
    pub async fn skipped_version(&self) -> Option<String> {
        if let Some(version) = self.skipped.lock().await.clone() {
            return Some(version);
        }
        let stored = read_state().skipped_version;
        *self.skipped.lock().await = stored.clone();
        stored
    }

    pub async fn set_skipped(&self, version: Option<String>) {
        *self.skipped.lock().await = version.clone();
        store_skipped_version(version).await;
    }

    /// Версия, о которой уже сообщили.
    ///
    /// Холодный старт: значение подхватывается из конфига, иначе после
    /// перезапуска `update-available` пришёл бы второй раз для той же версии —
    /// пользователь получил бы уведомление о том, что уже видел.
    pub async fn notified_version(&self) -> Option<String> {
        if let Some(version) = self.notified.lock().await.clone() {
            return Some(version);
        }
        let stored = read_state().notified_version;
        *self.notified.lock().await = stored.clone();
        stored
    }

    /// Помечает версию как «уже сообщённую» — в памяти и в конфиге.
    pub async fn set_notified(&self, version: &str) {
        *self.notified.lock().await = Some(version.to_owned());
        store_notified_version(version).await;
    }

    /// Фиксирует факт скачивания обновления.
    pub async fn set_last_download(&self) {
        if let Ok(mut guard) = self.last_download.try_lock() {
            *guard = Some(SystemTime::now());
        }
    }

    /// Фиксирует факт установки обновления.
    pub fn set_last_install(&self) {
        if let Ok(mut guard) = self.last_install.try_lock() {
            *guard = Some(SystemTime::now());
        }
    }
}

impl Default for UpdaterState {
    fn default() -> Self {
        UpdaterState::new()
    }
}

// ── Состояние на диске ───────────────────────────────────────────────────────

/// Подмена пути файла конфига — только для тестов.
///
/// Метки лежат в конфиге, поэтому тесты подменяют путь конфига через
/// `config::test_path`: иначе они писали бы в реальные настройки пользователя
/// и зависели бы от прошлых запусков приложения.
#[cfg(test)]
use crate::config::test_path as test_state;

/// Состояние автообновления из конфига.
fn read_state() -> UpdaterConfig {
    crate::config::load().updater.unwrap_or_default()
}

/// Сохраняет состояние автообновления в конфиг.
///
/// Запись идёт через `save_async`, поэтому она попадает в ту же очередь, что и
/// сохранения из рендерера, и не может оставить файл обрезанным. Ошибка
/// игнорируется: потеря метки означает лишь повторное уведомление, а падение
/// из-за неё сломало бы обновление.
///
/// Пустое состояние **не** отбрасывается, а сохраняется как отсутствие блока
/// `updater`. Раньше здесь был ранний выход, и он ломал снятие пропуска: если
/// `skippedVersion` был единственной меткой, обнуление делало состояние пустым,
/// запись не происходила — и после перезапуска пропуск возвращался, хотя
/// пользователь его снял.
pub async fn store_state(state: UpdaterConfig) {
    let mut config = crate::config::load();
    config.updater = if state.is_empty() { None } else { Some(state) };
    if let Err(err) = crate::config::save_async(config).await {
        logger::warn("Updater", &format!("Failed to save updater state: {err}"));
    }
}

/// Сохраняет отклонённую версию, не затирая остальные метки.
pub async fn store_skipped_version(version: Option<String>) {
    let mut state = read_state();
    if state.skipped_version == version {
        return;
    }
    state.skipped_version = version;
    store_state(state).await;
}

/// Сохраняет версию, о которой уже сообщили: после перезапуска `update-available`
/// для неё повторно не отправляется.
pub async fn store_notified_version(version: &str) {
    let mut state = read_state();
    if state.notified_version.as_deref() == Some(version) {
        return;
    }
    state.notified_version = Some(version.to_owned());
    store_state(state).await;
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

// ── Конфигурация ─────────────────────────────────────────────────────────────

/// Сконфигурировано ли автообновление.
///
/// `false` ⇒ UI показывает «обновление недоступно», и обновление не
/// предпринимается вовсе. Это защищает сборки без ключа подписи.
pub fn is_updater_configured(app: &AppHandle) -> bool {
    plugin_value(app, "pubkey")
        .as_ref()
        .and_then(Value::as_str)
        .map(|pubkey| !pubkey.is_empty() && !pubkey.contains(PUBKEY_PLACEHOLDER))
        .unwrap_or(false)
}

/// Значение из секции `plugins.updater` конфига Tauri.
fn plugin_value(app: &AppHandle, key: &str) -> Option<Value> {
    app.config().plugins.0.get("updater")?.get(key).cloned()
}

/// Endpoint манифеста обновлений: из конфига, с переопределением через
/// окружение.
pub fn endpoint(app: &AppHandle) -> Option<String> {
    if let Ok(value) = std::env::var(ENDPOINT_ENV) {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_owned());
        }
    }

    plugin_value(app, ENDPOINTS_KEY)
        .as_ref()
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

impl CheckUpdateResult {
    /// Обновлений нет — без ошибки.
    fn none() -> Self {
        CheckUpdateResult {
            available: false,
            version: None,
            url: None,
            release_notes: None,
            error: None,
        }
    }

    /// Обновление найдено, но предложить его нельзя: версия отклонена
    /// пользователем либо это пре-релиз при выключенной настройке.
    ///
    /// Версия и примечания возвращаются, чтобы UI мог показать, что релиз
    /// существует, но показывать его не будет.
    fn withheld(update: &Update) -> Self {
        CheckUpdateResult {
            available: false,
            version: Some(update.version.clone()),
            url: None,
            release_notes: update.body.clone(),
            error: None,
        }
    }

    /// Проверка сорвалась — пользователю есть что сказать.
    fn failed(message: String) -> Self {
        CheckUpdateResult {
            available: false,
            version: None,
            url: None,
            release_notes: None,
            error: Some(message),
        }
    }
}

// ── Разбор версий ────────────────────────────────────────────────────────────

/// Является ли версия pre-release сборкой (`4.1.0-rc.1`).
///
/// Проверяется суффикс после `-`, а не разбор semver: назначение функции —
/// отсечь пре-релиз от пользователя со стабильной сборки, для чего годятся
/// три строки. Метаданные сборки (`+build.7`) префиксом не считаются.
pub fn is_pre_release(version: &str) -> bool {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split('+')
        .next()
        .unwrap_or_default()
        .contains('-')
}

/// Числовые сегменты версии; `None`, если версия не распознана.
///
/// Пре-релизный суффикс и ведущий `v` отбрасываются, недостающие сегменты
/// считаются нулями (`4.0` → `[4, 0, 0]`).
fn version_segments(value: &str) -> Option<Vec<u64>> {
    let core = value.trim().trim_start_matches(['v', 'V']);
    let core = core.split('+').next().unwrap_or(core);
    let core = core.split('-').next().unwrap_or(core);

    let raw: Vec<&str> = core.split('.').collect();
    if raw.is_empty() || raw.len() > 4 {
        return None;
    }
    let mut segments = Vec::with_capacity(raw.len());
    for segment in &raw {
        segments.push(segment.trim().parse::<u64>().ok()?);
    }
    while segments.len() < 3 {
        segments.push(0);
    }
    Some(segments)
}

/// Откат ли `candidate` относительно `current`.
///
/// Страховка перед скачиванием: версия пришла из плагина, который уже
/// отфильтровал всё, что не новее текущей, — но между проверкой и установкой
/// состояние могло измениться.
///
/// * меньшие числовые сегменты — откат (`3.9.9` при `4.0.0`);
/// * равные сегменты, где `candidate` — пре-релиз, а `current` — релиз:
///   откат по каналу, стабильному пользователю нельзя предлагать пре-релиз
///   тех же сегментов (`4.0.0-rc.1` при установленном `4.0.0`);
/// * внутри пре-релизов порядок не разбирается: различать `rc.1` и `rc.2`
///   здесь незачем, обновление пришло из плагина.
///
/// Обратный переход — `4.0.0-rc.1` → `4.0.0` — откатом **не** считается.
/// Это не перестраховка, а рабочий сценарий: пользователь на тесте не должен
/// быть заперт на своей rc-сборке, иначе релиз до него не дойдёт никогда.
///
/// Нераспознанная версия откатом не считается: битый манифест не должен
/// блокировать обновление, которого предлагает не предложить нечего.
pub fn is_rollback(candidate: &str, current: &str) -> bool {
    let (Some(candidate_segments), Some(current_segments)) =
        (version_segments(candidate), version_segments(current))
    else {
        return false;
    };

    if candidate_segments != current_segments {
        return candidate_segments < current_segments;
    }

    is_pre_release(candidate) && !is_pre_release(current)
}

/// Ошибка плагина, означающая «обновлять нечего», а не сбой.
///
/// `tauri-plugin-updater` ищет платформу (`windows-x86_64`) в объекте
/// `platforms` манифеста **до** того, как сравнить версии, поэтому пустой
/// `platforms` даёт `TargetNotFound`/`TargetsNotFound` даже при заведомо
/// меньшей версии. Для приложения это то же состояние, что и «обновлений нет»:
/// показывать пользователю ошибку не о чем — скачивать всё равно нечего.
///
/// `ReleaseNotFound` сюда не входит: это битый или недоступный endpoint, и о
/// нём пользователю сказать полезно.
pub fn is_no_update_error(error: &tauri_plugin_updater::Error) -> bool {
    matches!(
        error,
        tauri_plugin_updater::Error::TargetNotFound(_) | tauri_plugin_updater::Error::TargetsNotFound(_)
    )
}

// ── Основные операции ────────────────────────────────────────────────────────

/// Проверяет наличие обновления.
///
/// `allow_pre_release` ⇒ дополнительно предлагаются pre-release сборки.
///
/// Никогда не выдаёт ошибку наружу как исключение: неудачная проверка — это
/// `error` в результате, а не падение. Приложение продолжает работать на
/// текущей версии.
pub async fn check(app: &AppHandle, state: &UpdaterState, allow_pre_release: bool) -> CheckUpdateResult {
    emit_status(app, STATUS_CHECKING);

    if !is_updater_configured(app) {
        emit_status(app, STATUS_NOT_AVAILABLE);
        return CheckUpdateResult::none();
    }

    let update = match fetch(app).await {
        Ok(update) => update,
        Err(message) => {
            emit_error(app, &message);
            emit_status(app, STATUS_ERROR);
            return CheckUpdateResult::failed(message);
        }
    };

    let Some(update) = update else {
        emit_status(app, STATUS_NOT_AVAILABLE);
        return CheckUpdateResult::none();
    };

    // Манифест один и общий для обоих каналов, а плагин пре-релизы не
    // отсекает: фильтр обязан быть здесь.
    if !allow_pre_release && is_pre_release(&update.version) {
        logger::debug(
            "Updater",
            &format!("manifest offers pre-release {} while it is disabled", update.version),
        );
        emit_status(app, STATUS_NOT_AVAILABLE);
        return CheckUpdateResult::withheld(&update);
    }

    // Отклонённая версия больше не предлагается, но проверка считается успешной.
    if state.skipped_version().await.as_deref() == Some(update.version.as_str()) {
        emit_status(app, STATUS_NOT_AVAILABLE);
        return CheckUpdateResult::withheld(&update);
    }

    let info = UpdateInfo {
        version: update.version.clone(),
        url: Some(update.download_url.to_string()),
        release_notes: update.body.clone(),
    };
    state.set_pending(update).await;

    // Одно уведомление на версию: иначе событие повторялось бы на каждой
    // фоновой проверке, а после перезапуска — снова. Метка хранится в конфиге,
    // поэтому переживает холодный старт.
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

/// Обновление, объявленное манифестом.
///
/// `Ok(None)` ⇒ предлагать нечего (в манифесте нет артефакта под эту
/// платформу). `Err` ⇒ сбой, о котором пользователю есть что сказать.
async fn fetch(app: &AppHandle) -> Result<Option<Update>, String> {
    let mut builder = app.updater_builder();
    if let Some(endpoint) = endpoint(app) {
        let endpoint = endpoint
            .parse::<tauri::Url>()
            .map_err(|error| error.to_string())?;
        builder = builder
            .endpoints(vec![endpoint])
            .map_err(|error| error.to_string())?;
    }
    let updater = builder.build().map_err(|error| error.to_string())?;

    match updater.check().await {
        Err(error) if is_no_update_error(&error) => {
            logger::debug("Updater", "manifest has no artifact for this platform — no update offered");
            Ok(None)
        }
        Err(error) => Err(error.to_string()),
        Ok(update) => Ok(update),
    }
}

/// Проверки, общие для скачивания и установки.
///
/// Вызываются в обоих местах по одной причине: между проверкой обновления и
/// установкой пользователь мог выключить получение pre-release, а версия —
/// оказаться откатом. Проверка **до** извлечения состояния: отказ не должен
/// оставлять кнопку «обновить» мёртвой до следующей проверки.
fn reject_unusable(version: &str) -> Option<String> {
    if is_rollback(version, CURRENT_VERSION) {
        return Some(format!(
            "Обновление {version} не новее установленной версии {CURRENT_VERSION}"
        ));
    }

    if is_pre_release(version) && !crate::config::load().allow_pre_release_updates {
        return Some(format!(
            "Обновление {version} — pre-release сборка, а получение pre-release выключено"
        ));
    }

    None
}

/// Скачивает и проверяет подпись найденного обновления.
///
/// Файл установщика сохраняется в состоянии и ждёт отдельной команды
/// установки: пользователь сам выбирает момент, когда приложение будет
/// заменено. Возвращает список файлов-ошибок (пустой при успехе) — формат
/// ответа совпадает с `DownloadUpdateResult` (`string[]`) в Electron-версии.
pub async fn start_download(app: &AppHandle, state: &UpdaterState) -> Vec<String> {
    if !is_updater_configured(app) {
        return vec!["Автообновление не настроено: не задан публичный ключ подписи".to_owned()];
    }

    let Some(version) = state.pending_version().await else {
        return vec!["Нет подготовленного обновления".to_owned()];
    };
    if let Some(reason) = reject_unusable(&version) {
        return vec![reason];
    }
    let Some(update) = state.pending_update().await else {
        return vec!["Нет подготовленного обновления".to_owned()];
    };

    emit_status(app, STATUS_DOWNLOADING);

    let installer = match download(&update, app).await {
        Ok(installer) => installer,
        // Подпись не совпала или загрузка оборвалась: установленное
        // приложение не изменено, подготовленное обновление остаётся пригодным
        // для повторной попытки.
        Err(message) => {
            logger::error("Updater", &format!("Update download failed, current build kept: {message}"));
            emit_error(app, &message);
            emit_status(app, STATUS_ERROR);
            return vec![message];
        }
    };

    state.set_installer(installer).await;
    state.set_last_download().await;
    store_last_download().await;
    emit_status(app, STATUS_DOWNLOADED);
    Vec::new()
}

/// Скачивает установщик, отдавая прогресс в UI.
///
/// Подпись проверяется плагином внутри `download`, поэтому неподписанный файл
/// не может попасть в результат.
async fn download(update: &Update, app: &AppHandle) -> Result<Vec<u8>, String> {
    let mut downloaded = 0u64;
    let mut total = 0u64;
    let mut last_emit = std::time::Instant::now() - Duration::from_millis(200);
    let handle = app.clone();

    update
        .download(
            move |chunk, length| {
                downloaded = downloaded.saturating_add(chunk as u64);
                total = length.unwrap_or(total).max(downloaded);
                let now = std::time::Instant::now();
                if now.duration_since(last_emit) < Duration::from_millis(200) {
                    return;
                }
                last_emit = now;
                let percent = if total > 0 {
                    ((downloaded as f64 / total as f64) * 100.0).round().min(100.0) as u32
                } else {
                    0
                };
                let _ = handle.emit(
                    "update-progress",
                    UpdateProgress {
                        percent,
                        total,
                        transferred: downloaded,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())
}

/// Устанавливает скачанное обновление и перезапускает приложение.
///
/// Вызывается только по явному действию пользователя и только когда установщик
/// уже скачан. На Windows `install` запускает установщик и завершает процесс, и
/// до перезапуска управление не доходит; на остальных платформах приложение
/// стартует заново.
pub async fn install_update(app: &AppHandle, state: &UpdaterState) -> Result<(), String> {
    if !is_updater_configured(app) {
        return Err("Автообновление не настроено: не задан публичный ключ подписи".to_owned());
    }

    let Some(version) = state.pending_version().await else {
        return Err("Нет подготовленного обновления".to_owned());
    };
    if let Some(reason) = reject_unusable(&version) {
        return Err(reason);
    }

    emit_status(app, STATUS_INSTALLING);

    // Установщик читается под мьютексом, а не извлекается: на Windows процесс
    // здесь завершается, но на других платформах `install` может вернуть
    // ошибку, и тогда скачанный файл обязан остаться пригодным для повтора.
    let guard = state.pending.lock().await;
    let Some(pending) = guard.as_ref() else {
        return Err("Нет подготовленного обновления".to_owned());
    };
    let Some(installer) = pending.installer.as_ref() else {
        return Err("Обновление ещё не скачано".to_owned());
    };
    if let Err(error) = pending.update.install(installer) {
        let message = error.to_string();
        logger::error("Updater", &format!("Update install failed, current build kept: {message}"));
        emit_error(app, &message);
        emit_status(app, STATUS_ERROR);
        return Err(message);
    }
    drop(guard);

    state.set_last_install();
    store_last_install().await;
    logger::info("Updater", "Restarting application to finish update");
    // `restart` не возвращает управление: на Windows процесс уже завершён
    // установщиком, на остальных платформах — завершится здесь.
    app.restart()
}

/// Фиксирует факт проверки обновлений: в памяти и в конфиге.
pub async fn set_last_check(state: &UpdaterState) {
    if let Ok(mut guard) = state.last_check.try_lock() {
        *guard = Some(SystemTime::now());
    }
    let mut current = read_state();
    current.last_check = Some(now_millis());
    store_state(current).await;
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

async fn store_last_download() {
    let mut current = read_state();
    current.last_download = Some(now_millis());
    store_state(current).await;
}

async fn store_last_install() {
    let mut current = read_state();
    current.last_install = Some(now_millis());
    store_state(current).await;
}

/// Метки времени последней проверки/загрузки/установки (для диагностики).
pub fn state_snapshot() -> Value {
    serde_json::to_value(read_state()).unwrap_or(Value::Null)
}

#[cfg(test)]
#[path = "tests/updates.rs"]
mod tests;