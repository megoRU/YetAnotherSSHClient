//! Распаковка архивов на сервере — порт `SftpArchiveService.ts`.
//!
//! Распаковка выполняется удалённой командой: приложение не разбирает форматы
//! самостоятельно, поддерживается ровно тот набор, что и раньше.

use crate::sftp::utils;
use crate::ssh::session::Connection;

/// Команда распаковки для пути, либо `None` для неподдерживаемого формата.
pub fn extract_command(remote_path: &str) -> Option<String> {
    let extension = std::path::Path::new(remote_path)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let path = utils::escape_remote_path(remote_path);
    let dir = std::path::Path::new(remote_path)
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_owned());
    let dir = utils::escape_remote_path(&dir);

    match extension.as_str() {
        "zip" => Some(format!("unzip -o {path} -d {dir}")),
        "tar" => Some(format!("tar -xf {path} -C {dir}")),
        "gz" | "tgz" => Some(format!("tar -xzf {path} -C {dir}")),
        "bz2" => Some(format!("tar -xjf {path} -C {dir}")),
        _ => None,
    }
}

/// Выполняет распаковку и проверяет код возврата.
pub async fn extract(connection: &Connection, remote_path: &str) -> Result<bool, String> {
    let Some(command) = extract_command(remote_path) else {
        return Err(crate::i18n::t("errors.unsupportedArchive", &[]));
    };

    match crate::ssh::session::exec(connection, &command).await {
        Ok(outcome) => {
            if outcome.code == Some(0) {
                Ok(true)
            } else {
                let code = outcome.code.unwrap_or(-1);
                let message = if outcome.stderr.is_empty() {
                    outcome.stdout.clone()
                } else {
                    outcome.stderr.clone()
                };
                if message.trim().is_empty() {
                    Err(crate::i18n::t("errors.extractError", &[("code", &code.to_string())]))
                } else {
                    Err(message)
                }
            }
        }
        Err(err) => Err(err.localized()),
    }
}

#[cfg(test)]
#[path = "../tests/sftp_archive.rs"]
mod tests;
