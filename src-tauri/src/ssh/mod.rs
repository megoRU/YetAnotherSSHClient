//! Слой SSH на чистом Rust (`russh`).
//!
//! Модули:
//! * [`auth`] — выбор способа авторизации (порт `auth-credentials.ts`);
//! * [`handler`] — реализация `russh::client::Handler` и типы ошибок;
//! * [`session`] — установка соединения, авторизация, каналы, exec;
//! * [`registry`] — жизненный цикл сессий, вывод терминала, проброс портов
//!   (порт `ssh-manager.ts` + `ssh-auth.ts`).

pub mod auth;
pub mod fingerprint;
pub mod handler;
pub mod registry;
pub mod session;

pub use auth::{is_login_required, known_password, AuthPlan, SessionAuth};
pub use fingerprint::{
    emit_fingerprint_saved, FingerprintChallenge, FingerprintGate, FingerprintOutcome, FingerprintSaved,
    FINGERPRINT_REQUEST_EVENT, FINGERPRINT_SAVED_EVENT,
};
pub use handler::{host_key_fingerprint, ClientHandler, ExitStatusMap, HandlerEvent, SshError};
pub use registry::{AuthResponse, ResponseKind, SessionRegistry};
pub use session::{
    build_keyboard_responses, connect, exec, open_session_channel, ConnectOutcome, Connection, ExecOutcome,
    SecretPrompt, SharedHandle, EXEC_TIMEOUT,
};

pub use handler::take_offered_key;
