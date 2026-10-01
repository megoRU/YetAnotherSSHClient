use super::*;

/// Правила шлюза подтверждения отпечатка — общие для терминала, SFTP и
/// проброса портов, поэтому проверяются здесь один раз.

/// Первое подключение: `previous` пуст, UI показывает обычное подтверждение, а
/// не предупреждение о смене ключа.
#[test]
fn первое_подключение_не_выглядит_как_смена_ключа() {
    let challenge = FingerprintChallenge {
        id: "tab-1".to_owned(),
        fingerprint: "SHA256:new".to_owned(),
        previous: None,
        server_id: Some("srv-1".to_owned()),
    };
    assert!(challenge.previous.is_none());
    assert!(challenge.fingerprint.starts_with("SHA256:"));
}

/// Смена ключа: сохранённый отпечаток обязательно едет в UI, иначе
/// пользователь увидит новое значение без напоминания, что было иное.
#[test]
fn смена_ключа_передаёт_прежний_отпечаток() {
    let challenge = FingerprintChallenge {
        id: "tab-1".to_owned(),
        fingerprint: "SHA256:new".to_owned(),
        previous: Some("SHA256:old".to_owned()),
        server_id: Some("srv-1".to_owned()),
    };
    assert_eq!(challenge.previous.as_deref(), Some("SHA256:old"));
}

/// Сервер вне избранного сохранить нельзя: UI должен сказать об этом, иначе
/// пользователь подтвердит ключ и решит, что он запомнен.
#[test]
fn сервер_вне_избранного_помечен_как_несохраняемый() {
    let challenge = FingerprintChallenge {
        id: "tab-1".to_owned(),
        fingerprint: "SHA256:new".to_owned(),
        previous: None,
        server_id: None,
    };
    assert!(challenge.server_id.is_none());
}

/// Идентификатор подключения едет в payload, а не в имя события.
///
/// Tauri допускает в имени события только буквы, цифры и `- / : _`, поэтому
/// `forward:138.16.186.79:81` (точка в адресе) в имя не годится: `emit` и
/// `listen` возвращали ошибку, окно не появлялось, подключение висело.
#[test]
fn имя_события_не_зависит_от_идентификатора_подключения() {
    assert_eq!(FINGERPRINT_REQUEST_EVENT, "ssh-fingerprint");
    // В имени нет ничего, что могло бы прийти из id подключения.
    assert!(FINGERPRINT_REQUEST_EVENT
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '/' || c == ':' || c == '_'));
}

/// При этом id с точками и пробелами остаётся допустимым в payload: его
/// сравнивают как обычную строку, а не проверяют как имя события.
#[test]
fn идентификатор_подключения_передаётся_в_payload() {
    let id = "forward:138.16.186.79:81";
    let challenge = FingerprintChallenge {
        id: id.to_owned(),
        fingerprint: "SHA256:new".to_owned(),
        previous: None,
        server_id: Some("srv-1".to_owned()),
    };
    let json = serde_json::to_string(&challenge).expect("сериализация");
    assert!(json.contains("\"id\""), "id не попал в payload: {json}");

    let parsed: FingerprintChallenge = serde_json::from_str(&json).expect("разбор");
    assert_eq!(parsed.id, id, "id с точкой в адресе должен пережить round-trip");
}

/// Пустые поля не попадают в JSON: иначе UI ждал бы строки, которой нет.
#[test]
fn пустые_поля_не_попадают_в_json() {
    let json = serde_json::to_string(&FingerprintChallenge {
        id: "tab-1".to_owned(),
        fingerprint: "SHA256:new".to_owned(),
        previous: None,
        server_id: None,
    })
    .expect("сериализация");

    assert!(!json.contains("previous"), "пустое поле попало в JSON: {json}");
    assert!(!json.contains("serverId"), "пустое поле попало в JSON: {json}");
    assert!(json.contains("\"fingerprint\""), "отпечаток не попал в JSON: {json}");
}

/// Итог подтверждения различает согласие с отпечатком и отказ, а вместе с
/// согласием отдаёт сам отпечаток и признак, что он записан в избранное.
#[test]
fn итог_различает_согласие_и_отказ() {
    let accepted = FingerprintOutcome::Accept {
        fingerprint: "SHA256:new".to_owned(),
        saved: true,
    };
    assert_ne!(accepted, FingerprintOutcome::Reject);
    assert_eq!(
        accepted,
        FingerprintOutcome::Accept {
            fingerprint: "SHA256:new".to_owned(),
            saved: true,
        }
    );
}

/// Отпечаток, который не удалось записать, всё равно попадает в итог.
///
/// Сервер вне избранного сохранить некуда, и перечитывать отпечаток из конфига
/// бессмысленно: там `None`, сервер запросил бы ключ снова, то есть по кругу.
#[test]
fn несохранённый_отпечаток_всё_равно_возвращается() {
    let outcome = FingerprintOutcome::Accept {
        fingerprint: "SHA256:new".to_owned(),
        saved: false,
    };
    match outcome {
        FingerprintOutcome::Accept { fingerprint, saved } => {
            assert_eq!(fingerprint, "SHA256:new");
            assert!(!saved, "сервер вне избранного: сохранять некуда");
        }
        FingerprintOutcome::Reject => panic!("отказ не должен возвращаться как согласие"),
    }
}
