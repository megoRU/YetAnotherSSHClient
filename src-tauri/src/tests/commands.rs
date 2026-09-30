use super::*;

/// Ключ `platform` в словаре бэкенда используется как есть, поэтому
/// команда обязана отдавать те же значения, что ждёт фронтенд.
#[test]
fn платформа_в_терминах_фронтенда() {
    let value = platform();
    assert!(
        matches!(value.as_str(), "win32" | "darwin" | "linux"),
        "неожиданное значение платформы: {value}"
    );
    assert_eq!(value, paths::platform_id());
}

#[test]
fn секреты_хранятся_по_идентификатору_сервера() {
    // `encrypted_passwords`/`encrypted_key_passphrases` — единственное
    // место, где лежат пароли; без `id` сервера они недоступны.
    let config = AppConfig {
        encrypted_passwords: Some(BTreeMap::from([("srv-1".to_owned(), dummy_secret())])),
        encrypted_key_passphrases: Some(BTreeMap::from([("srv-2".to_owned(), dummy_secret())])),
        ..AppConfig::default()
    };

    assert!(config.encrypted_passwords.as_ref().expect("store").contains_key("srv-1"));
    assert!(!config.encrypted_passwords.as_ref().expect("store").contains_key("srv-2"));
    assert!(config.encrypted_key_passphrases.as_ref().expect("store").contains_key("srv-2"));
}

fn dummy_secret() -> EncryptedSecret {
    EncryptedSecret {
        iv: "iv".to_owned(),
        tag: "tag".to_owned(),
        data: "data".to_owned(),
    }
}

/// Секреты не должны попадать в конфиг открытым текстом: после синхронизации
/// поле `password` у сервера очищается, а значение лежит в хранилище.
#[test]
fn открытый_пароль_переносится_в_хранилище() {
    let _guard = vault::test_guard();
    let (recovery_key, salt) = (
        paths::random_base64(32),
        paths::random_base64(16),
    );
    vault::unlock(&recovery_key, &salt).expect("открыть хранилище");

    let mut favorites = vec![SshConfig {
        id: Some("srv-1".to_owned()),
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        password: Some("открытый-пароль".to_owned()),
        ..SshConfig::default()
    }];
    let mut store: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
    config::sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, true);

    assert!(favorites[0].password.is_none(), "пароль остался в конфиге открытым");
    let stored = store.get("srv-1").expect("пароль должен попасть в хранилище");
    assert_eq!(vault::decrypt(stored).expect("расшифровать"), "открытый-пароль");
}
