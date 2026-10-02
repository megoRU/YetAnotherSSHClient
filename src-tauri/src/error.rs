//! Тип ошибки, общий для всех команд Tauri.
//!
//! Фронтенд ожидает из IPC обычные строки (`electron/src/ipc-handlers.ts`
//! отдавал локализованный текст), поэтому [`AppError`] сериализуется именно
//! как строка с уже переведённым сообщением. Это позволяет не трогать React:
//! `catch` в существующем коде остаётся рабочим без изменений.

use serde::{Serialize, Serializer};

use crate::i18n;

/// Ошибка, которую можно показать пользователю.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Сообщение уже локализовано.
    #[error("{0}")]
    Localized(String),

    /// Сообщение ещё не переведено: ключ + параметры.
    #[error("{0}")]
    Key(&'static str),

    /// Внутренняя ошибка, для пользователя показывается `fallback_key`.
    #[error("{fallback_key}")]
    Internal {
        fallback_key: &'static str,
        source: anyhow_lite::Error,
    },
}

/// Минимальная обёртка без отдельной зависимости `anyhow`.
pub mod anyhow_lite {
    use std::fmt;

    /// Неизвестная ошибка с сохранением исходного `Display`.
    #[derive(Debug)]
    pub struct Error(pub String);

    impl fmt::Display for Error {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(&self.0)
        }
    }

    impl std::error::Error for Error {}

    impl From<String> for Error {
        fn from(value: String) -> Self {
            Error(value)
        }
    }

    impl From<&str> for Error {
        fn from(value: &str) -> Self {
            Error(value.to_owned())
        }
    }

    impl From<std::io::Error> for Error {
        fn from(value: std::io::Error) -> Self {
            Error(value.to_string())
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    /// Локализованный текст для UI.
    pub fn localized(&self) -> String {
        match self {
            AppError::Localized(text) => text.clone(),
            AppError::Key(key) => i18n::t(key, &[]),
            AppError::Internal { fallback_key, source } => {
                // Технический текст не показываем пользователю, но сохраняем в логе
                // через logger; в UI уходит только локализованный fallback.
                crate::logger::internal(&source.0);
                i18n::t(fallback_key, &[])
            }
        }
    }

    pub fn internal(fallback_key: &'static str) -> Self {
        AppError::Internal {
            fallback_key,
            source: anyhow_lite::Error(String::new()),
        }
    }

    pub fn with_source(fallback_key: &'static str, source: impl Into<String>) -> Self {
        AppError::Internal {
            fallback_key,
            source: anyhow_lite::Error(source.into()),
        }
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        AppError::Localized(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        AppError::Localized(value.to_owned())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.localized())
    }
}

#[cfg(test)]
#[path = "tests/error.rs"]
mod tests;
