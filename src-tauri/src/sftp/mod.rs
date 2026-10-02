//! SFTP — порт каталога `electron/src/sftp/`.
//!
//! * [`session`] — соединения вкладок, кэш SFTP-каналов, жизненный цикл
//!   трансферов (порт `SftpConnection.ts` + `SftpTransferManager.ts`);
//! * [`files`] — операции над файлами и каталогами (`SftpFileService.ts`);
//! * [`transfer`] — загрузка/скачивание и агрегированный прогресс
//!   (`SftpUploadService.ts`, `SftpDownloadService.ts`, воркер передач);
//! * [`archive`] — распаковка удалённых архивов (`SftpArchiveService.ts`);
//! * [`utils`] — пути, промоут временного файла, размеры;
//! * [`progress`] — сглаживание событий прогресса.

pub mod archive;
pub mod files;
pub mod progress;
pub mod session;
pub mod transfer;
pub mod utils;

pub use progress::{ProgressBatcher, ProgressReporter, SftpProgress};
pub use session::{
    classify_error, emit_status, SftpErrorEvent, SftpErrorKind, SftpManager, SftpStatusEvent, SftpStatusKind, TransferState,
};
pub use transfer::{Direction, TransferContext, TransferOutcome};
