//! Подтверждение отпечатка ключа хоста — общий шлюз для всех типов подключения.
//!
//! Терминал, SFTP и проброс портов подключаются к одному серверу тремя разными
//! путями, и спросить отпечаток мог только терминал: остальные возвращали ошибку
//! со словами «подтвердите при обычном подключении». Пользователю это ничего не
//! объясняло — он не понимал, что делать, и не мог подтвердить ключ, не открыв
//! терминал.
//!
//! Шлюз решает это одним механизмом на всех:
//!
//! * [`FingerprintGate::request`] регистрирует ожидание и отправляет UI;
//! * рендерер отвечает командой `ssh_fingerprint_response`;
//! * [`FingerprintGate::resolve`] сохраняет отпечаток (при согласии) и отдаёт
//!   решение ожидающей задаче, которая продолжает подключение.
//!
//! Решение принимается **внутри** подключения, а не отдельным переподключением:
//! иначе SFTP и проброс портов потребовали бы дополнительного «повторить».
//!
//! Отмена (закрытие вкладки, остановка пересылки) убирает ожидание из шлюза:
//! отправитель `oneshot` разрывается, ожидающая задача видит ошибку канала и
//! тихо завершается — подключение не «зависает» на несуществующем ответе.

use std::collections::HashMap;

use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

use crate::config;
use crate::logger;

/// Событие запроса подтверждения: **одно на всё приложение**, без `id` в имени.
///
/// Tauri проверяет имя события и допускает только буквы, цифры и `- / : _`.
/// Идентификатор подключения в имя класть нельзя: у проброса портов это
/// `forward:138.16.186.79:81`, где точка в адресе запрещена, и `emit`/`listen`
/// молча возвращали ошибку — окно не появлялось, а подключение висело. Поэтому
/// `id` едет в payload, а подписчик отбирает своё.
pub const FINGERPRINT_REQUEST_EVENT: &str = "ssh-fingerprint";

/// Событие сохранённого отпечатка: общий для вкладок и редактора сервера.
pub const FINGERPRINT_SAVED_EVENT: &str = "ssh-fingerprint-saved";

/// Итог подтверждения отпечатка.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FingerprintOutcome {
    /// Отпечаток подтверждён.
    Accept {
        /// Подтверждённый отпечаток: его надо передать в переподключение.
        ///
        /// Отдаём его явно, а не читаем заново из конфига: у сервера вне
        /// избранного сохранять некуда, и чтение вернуло бы `None` — сервер
        /// запросил бы ключ снова, то есть по кругу.
        fingerprint: String,
        /// Удалось ли записать отпечаток в избранное. Для сервера вне избранного
        /// это `false`, и UI об этом предупредил при показе окна.
        saved: bool,
    },
    /// Пользователь отклонил ключ: подключение отменяется, сохранённое
    /// значение не меняется.
    Reject,
}

/// Запрос подтверждения отпечатка ключа хоста (`ssh-fingerprint-${id}`).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintChallenge {
    /// Подключение, которое ждёт ответа.
    pub id: String,
    /// Отпечаток, который предъявил сервер, в формате `SHA256:…`.
    pub fingerprint: String,
    /// Отпечаток, сохранённый ранее. `Some` означает смену ключа, и UI
    /// показывает предупреждение вместо обычного подтверждения.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
    /// `id` сервера в избранном, если он там есть: без него подтверждение
    /// показать можно, а сохранить некуда, и UI предупредит об этом.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
}

/// Отпечаток сохранён main-процессом (`FINGERPRINT_SAVED_EVENT`).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintSaved {
    pub id: String,
    pub fingerprint: String,
}

/// Сообщает рендереру, что отпечаток сохранён.
///
/// Снимок избранного в webview устаревает мгновенно после подтверждения, а
/// `ConnectionForm` показывает наличие отпечатка по нему. Без события сервер
/// выглядел бы неподтверждённым до перезапуска приложения.
pub fn emit_fingerprint_saved(app: &AppHandle, server_id: Option<&str>, fingerprint: &str) {
    let Some(id) = server_id.filter(|id| !id.is_empty()) else { return };
    let _ = app.emit(
        FINGERPRINT_SAVED_EVENT,
        FingerprintSaved { id: id.to_owned(), fingerprint: fingerprint.to_owned() },
    );
}

/// Ожидание ответа пользователя по конкретному подключению.
struct Pending {
    /// Отпечаток, который нужно сохранить при согласии.
    fingerprint: String,
    /// Сервер в избранном: без него подтверждение негде сохранить.
    server_id: Option<String>,
    /// Отправитель решения ожидающей задаче.
    decision: oneshot::Sender<FingerprintOutcome>,
}

/// Шлюз подтверждения отпечатка: хранит ожидания по `id` подключения.
#[derive(Default)]
pub struct FingerprintGate {
    pending: Mutex<HashMap<String, Pending>>,
}

impl FingerprintGate {
    pub fn new() -> Self {
        FingerprintGate::default()
    }

    /// Регистрирует ожидание и просит UI показать окно подтверждения.
    ///
    /// `server_id` нужен, чтобы сохранить отпечаток именно в этом сервере.
    /// Возвращает `None`, если для этого `id` уже есть ожидание: повторный
    /// запрос игнорируется, иначе первый отправитель разорвался бы без ответа.
    pub async fn request(
        &self,
        app: &AppHandle,
        id: &str,
        server_id: Option<&str>,
        fingerprint: String,
        previous: Option<String>,
    ) -> Option<oneshot::Receiver<FingerprintOutcome>> {
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().await;
            if pending.contains_key(id) {
                logger::warn("SSH", &format!("Fingerprint already requested for {id}, ignoring duplicate"));
                return None;
            }
            pending.insert(
                id.to_owned(),
                Pending {
                    fingerprint: fingerprint.clone(),
                    server_id: server_id.map(str::to_owned),
                    decision: tx,
                },
            );
        }

        logger::info(
            "SSH",
            &format!("Host fingerprint confirmation required for {id} (stored: {previous:?})"),
        );

        // Ошибку `emit` логируем: молчаливый `let _ =` уже скрывал неверное
        // имя события, и окно подтверждения просто не появлялось.
        if let Err(err) = app.emit(
            FINGERPRINT_REQUEST_EVENT,
            FingerprintChallenge {
                id: id.to_owned(),
                fingerprint,
                previous,
                server_id: server_id.map(str::to_owned),
            },
        ) {
            logger::error(
                "SSH",
                &format!("Failed to request fingerprint confirmation for {id}: {err}"),
            );
        }

        Some(rx)
    }

    /// Принимает решение пользователя: сохраняет отпечаток и будит подключение.
    ///
    /// `false` означает, что ожидания для такого `id` уже нет (вкладка закрыта
    /// или пришёл повторный ответ) — тогда делать нечего.
    pub async fn resolve(&self, app: &AppHandle, id: &str, accept: bool) -> bool {
        let Some(pending) = self.pending.lock().await.remove(id) else {
            logger::warn("SSH", &format!("No pending fingerprint confirmation for {id}"));
            return false;
        };

        if !accept {
            logger::info("SSH", &format!("Host fingerprint rejected for {id}"));
            return true;
        }

        // Отпечаток сохраняется **до** пробуждения подключения: следующая
        // попытка обязана пройти молча, иначе окно спросило бы то же самое ещё
        // раз. Ошибка записи не прерывает подключение — сервер ведь отвечает,
        // а метка просто не сохранится до следующего подтверждения.
        //
        // Подключению отпечаток отдаётся явно (`FingerprintOutcome::Accept`):
        // перечитывать его из конфига нельзя, у сервера вне избранного там
        // ничего нет, и сервер спросил бы ключ снова, то есть по кругу.
        let mut saved = false;
        if let Some(server_id) = pending.server_id.as_deref() {
            match config::set_favorite_fingerprint_by_id(server_id, &pending.fingerprint).await {
                Ok(()) => {
                    saved = true;
                    emit_fingerprint_saved(app, Some(server_id), &pending.fingerprint);
                }
                Err(err) => logger::warn("SSH", &format!("Failed to save host fingerprint: {err}")),
            }
        } else {
            logger::info(
                "SSH",
                &format!("Server is not in favorites; fingerprint kept for this connection only ({id})"),
            );
        }

        let _ = pending.decision.send(FingerprintOutcome::Accept {
            fingerprint: pending.fingerprint,
            saved,
        });
        true
    }

    /// Отменяет ожидание: отправитель разрывается, подключение завершается.
    pub async fn cancel(&self, id: &str) {
        self.pending.lock().await.remove(id);
    }
}

#[cfg(test)]
#[path = "../tests/ssh_fingerprint.rs"]
mod tests;
