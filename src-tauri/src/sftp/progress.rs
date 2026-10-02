//! Сглаживатель прогресса SFTP — порт `electron/src/sftp/sftp-progress-batcher.ts`.
//!
//! При загрузке/скачивании папки с тысячами мелких файлов каждая передача
//! присылает финальное событие прогресса. Без агрегации renderer получает
//! тысячи `sftp-progress-*` событий в секунду, главный поток webview
//! перегружается и окно начинает лагать (заметно при перетаскивании окна).
//!
//! Здесь события копятся по сессии и отправляются не чаще раза в
//! [`FLUSH_INTERVAL_MS`], причём по каждому `transferId` уходит только
//! последнее значение. Финальные 100% отправляются сразу.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

const FLUSH_INTERVAL: Duration = Duration::from_millis(100);

/// Событие прогресса; формат совпадает с `SftpProgress` на frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SftpProgress {
    pub id: String,
    #[serde(rename = "remotePath")]
    pub remote_path: String,
    pub progress: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transferred: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(rename = "type")]
    pub kind: &'static str,
}

#[derive(Default)]
struct PendingBatch {
    /// Последнее обновление по каждому `transferId`.
    updates: HashMap<String, SftpProgress>,
}

#[derive(Default)]
pub struct ProgressBatcher {
    batches: Mutex<HashMap<String, PendingBatch>>,
    /// Запланированные отправки: `session_id -> JoinHandle`.
    scheduled: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

impl ProgressBatcher {
    pub fn new() -> Self {
        ProgressBatcher::default()
    }

    /// Кладёт обновление в пачку; при 100% отправляет немедленно.
    ///
    /// `self: &Arc<Self>` — чтобы задача отложенной отправки могла держать
    /// сильную ссылку на батчер и не зависеть от времени жизни владельца.
    pub async fn push(self: &Arc<Self>, app: &AppHandle, session_id: &str, progress: SftpProgress) {
        if progress.id.is_empty() {
            return;
        }
        let is_complete = progress.progress >= 100;

        {
            let mut batches = self.batches.lock().await;
            batches
                .entry(session_id.to_owned())
                .or_default()
                .updates
                .insert(progress.id.clone(), progress);
        }

        if is_complete {
            self.flush(app, session_id).await;
            return;
        }

        let needs_schedule = self.scheduled.lock().await.get(session_id).is_none();
        if !needs_schedule {
            return;
        }

        let app = app.clone();
        let session_id = session_id.to_owned();
        let scheduled_session_id = session_id.clone();
        let batcher = self.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(FLUSH_INTERVAL).await;
            batcher.flush(&app, &session_id).await;
        });
        self.scheduled.lock().await.insert(scheduled_session_id, handle);
    }

    /// Отправляет накопленные обновления сессии.
    pub async fn flush(&self, app: &AppHandle, session_id: &str) {
        self.scheduled.lock().await.remove(session_id);

        let batch = self.batches.lock().await.remove(session_id);
        let Some(batch) = batch else { return };

        for update in batch.updates.into_values() {
            let _ = app.emit(&format!("sftp-progress-{session_id}"), update);
        }
    }
}

// ── Отчёт о прогрессе ────────────────────────────────────────────────────────

/// Агрегатор прогресса многофайлового трансфера (порт `TransferState`).
///
/// Папка передаётся файлами по очереди, поэтому состояние общее для всего
/// трансфера: `transferred` — сумма уже переданных байт по всем файлам, а
/// процент считается от размера всей папки.
#[derive(Debug)]
pub struct AggregateState {
    /// Байты, уже учтённые агрегатом; прибавляются на каждом отчёте.
    transferred: AtomicU64,
    total: u64,
    root_path: String,
}

impl AggregateState {
    pub fn new(root_path: &str, total: u64) -> Self {
        AggregateState { transferred: AtomicU64::new(0), total, root_path: root_path.to_owned() }
    }

    pub fn root_path(&self) -> &str {
        &self.root_path
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    /// Сколько байт уже учтено по всему трансферу.
    pub fn transferred(&self) -> u64 {
        self.transferred.load(Ordering::Relaxed)
    }

    /// Прибавляет `delta` байт к учтённым и возвращает
    /// `(передано, всего, процент)`.
    ///
    /// Значение не превышает `total`: размер папки — снимок на момент старта, а
    /// файлы могут измениться прямо во время загрузки.
    pub fn advance(&self, delta: u64) -> (u64, u64, u32) {
        let transferred = self
            .transferred
            .fetch_add(delta, Ordering::Relaxed)
            .saturating_add(delta)
            .min(self.total);
        (transferred, self.total, percent_of(transferred, self.total))
    }

    /// Доля прогресса в процентах (0..100).
    pub fn percent(&self) -> u32 {
        percent_of(self.transferred(), self.total)
    }
}

/// Доля прогресса в процентах; трансфер без данных считается завершённым.
fn percent_of(transferred: u64, total: u64) -> u32 {
    if total > 0 {
        (((transferred as f64 / total as f64) * 100.0).round() as u32).min(100)
    } else {
        100
    }
}

/// Доля прогресса отдельного файла в процентах.
pub fn ratio_progress(transferred: u64, total: u64, fallback: u32) -> u32 {
    if total > 0 {
        ((transferred as f64 / total as f64) * 100.0).round() as u32
    } else {
        fallback
    }
}

/// Репорт прогресса с троттлингом; финальные 100% проходят сразу.
pub struct ProgressReporter {
    pub session_id: String,
    pub transfer_id: String,
    pub kind: &'static str,
    last_emit: std::time::Instant,
    throttle: Duration,
    /// Сколько байт текущего файла уже учтено агрегатом.
    counted: u64,
}

impl ProgressReporter {
    pub fn new(session_id: &str, transfer_id: &str, kind: &'static str) -> Self {
        let throttle = Duration::from_millis(100);
        ProgressReporter {
            session_id: session_id.to_owned(),
            transfer_id: transfer_id.to_owned(),
            kind,
            // Отсчёт «давно»: первый прогресс уходит сразу — как в TS-версии,
            // где lastProgressTime инициализируется нулём.
            last_emit: std::time::Instant::now() - throttle,
            throttle,
            counted: 0,
        }
    }

    /// Приращение байт текущего файла с прошлого отчёта.
    ///
    /// Агрегатору нужна именно дельта: файлы папки идут по очереди, а отчёты по
    /// одному файлу повторяют его накопленный размер — без вычитания одни и те
    /// же байты учитывались бы несколько раз.
    pub fn count_delta(&mut self, transferred: u64) -> u64 {
        let delta = transferred.saturating_sub(self.counted);
        self.counted = transferred;
        delta
    }

    /// Отправляет обновление, если прошло достаточно времени или прогресс финальный.
    pub async fn emit(
        &mut self,
        app: &AppHandle,
        batcher: &Arc<ProgressBatcher>,
        remote_path: &str,
        progress: u32,
        transferred: Option<u64>,
        total: Option<u64>,
    ) {
        if progress < 100 && self.last_emit.elapsed() < self.throttle {
            return;
        }
        self.last_emit = std::time::Instant::now();
        batcher
            .push(
                app,
                &self.session_id,
                SftpProgress {
                    id: self.transfer_id.clone(),
                    remote_path: remote_path.to_owned(),
                    progress,
                    transferred,
                    total,
                    kind: self.kind,
                },
            )
            .await;
    }
}

#[cfg(test)]
#[path = "../tests/sftp_progress.rs"]
mod tests;
