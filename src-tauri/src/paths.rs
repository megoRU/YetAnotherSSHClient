//! Пути приложения и мелкие системные утилиты.
//!
//! Имена файлов и расположение конфига совпадают с Electron-версией
//! (`~/.minissh_config.json`), чтобы переход между сборками не терял данные
//! пользователя, а бэкапы оставались взаимозаменяемыми.

use std::path::PathBuf;

pub const CONFIG_FILE_NAME: &str = ".minissh_config.json";
pub const UPDATER_STATE_FILE_NAME: &str = ".minissh_updater.json";
pub const KEYCHAIN_SERVICE: &str = "com.yash.client";
pub const KEYCHAIN_USER: &str = "vault-recovery-key";

/// Домашняя директория пользователя.
pub fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE")
            .or_else(|| match (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
                (Some(drive), Some(path)) => Some(format!("{}{}", drive.to_string_lossy(), path.to_string_lossy()).into()),
                _ => None,
            })
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Каталог конфигурации. На Windows `os.homedir()` в Node.js и `%USERPROFILE%`
/// совпадают, поэтому путь остаётся тем же.
pub fn config_dir() -> Option<PathBuf> {
    home_dir()
}

/// Полный путь к файлу конфигурации.
pub fn config_path() -> Option<PathBuf> {
    config_dir().map(|dir| dir.join(CONFIG_FILE_NAME))
}

/// Файл состояния автообновления (skipped/seen version).
///
/// Отдельный от `AppConfig`, чтобы формат конфига оставался совместимым с
/// Electron-версией в обе стороны: бэкап, импортированный в Tauri-сборку, не
/// приносит лишних полей, и наоборот.
pub fn updater_state_path() -> Option<PathBuf> {
    config_dir().map(|dir| dir.join(UPDATER_STATE_FILE_NAME))
}

/// Временный каталог, из которого Electron удалял осиротевшие `yash_*` папки.
pub fn temp_dir() -> Option<PathBuf> {
    std::env::temp_dir().into()
}

/// `os.release()` в терминах Rust (для заголовка экспорта логов).
pub fn os_release() -> String {
    std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .map(|value| value.trim().to_owned())
        .unwrap_or_else(|_| "unknown".to_owned())
}

/// Имя платформы в терминах renderer: `win32` | `darwin` | `linux` | …
///
/// Значение подставляется в `window.ipcRenderer.platform`, который фронтенд
/// использует для выбора поведения горячих клавиш и текста справки.
pub fn platform_id() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "freebsd") {
        "freebsd"
    } else if cfg!(target_os = "openbsd") {
        "openbsd"
    } else {
        "unknown"
    }
}

/// UUIDv4 из системной энтропии (для `clientId` и генераторов имён сессий).
pub fn new_uuid() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        // Энтропия недоступна — деградация, но не падение: значение всё равно
        // уникально в пределах сессии за счёт счётчика времени.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        bytes[..8].copy_from_slice(&nanos.to_be_bytes());
        bytes[8..].copy_from_slice(&(std::process::id() as u64).to_be_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Случайные байты в base64 (recovery key, соль, токены).
pub fn random_base64(len: usize) -> String {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    let mut bytes = vec![0u8; len];
    if getrandom::fill(&mut bytes).is_err() {
        let seed = new_uuid();
        let digest = simple_digest(seed.as_bytes());
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = digest[index % digest.len()];
        }
    }
    STANDARD.encode(bytes)
}

/// Некриптографический дайджест (FNV-1a, 32 байта) — только для заполнения
/// буфера, если системная энтропия недоступна.
fn simple_digest(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(32);
    let mut state: u64 = 0xcbf2_9ce4_8422_2325;
    for _ in 0..4 {
        for byte in input {
            state ^= u64::from(*byte);
            state = state.wrapping_mul(0x1000_0000_01b3);
        }
        out.extend_from_slice(&state.to_be_bytes());
    }
    out
}

/// Очищает осиротевшие временные каталоги `yash_*` старше 24 часов
/// (порт `cleanupOrphanedTempDirs` из `electron/main.ts`).
pub fn cleanup_orphaned_temp_dirs() {
    let Some(temp) = temp_dir() else { return };
    let Ok(entries) = std::fs::read_dir(&temp) else { return };

    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with("yash_") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        let Ok(modified) = metadata.modified() else { continue };
        let Ok(age) = now.duration_since(modified) else { continue };
        if age > std::time::Duration::from_secs(24 * 60 * 60) {
            let path = entry.path();
            match std::fs::remove_dir_all(&path) {
                Ok(()) => crate::logger::info("Init", &format!("Cleaned up orphaned temp dir: {}", path.display())),
                Err(err) => crate::logger::warn("Init", &format!("Failed to remove {}: {err}", path.display())),
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/paths.rs"]
mod tests;
