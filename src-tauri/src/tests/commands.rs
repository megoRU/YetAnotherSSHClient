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

/// Полный цикл отпечатка: подтверждение сохраняет его в избранном, удаление
/// действительно убирает значение, а сохранение снимка конфига из рендерера его
/// не восстанавливает.
///
/// Последнее — главное: `save_config` приходит со снимком webview, где отпечатка
/// нет. Без `preserve_fingerprints` любое сохранение настроек стирало бы его, и
/// пользователь подтверждал бы ключ заново при каждом подключении.
#[tokio::test]
async fn отпечаток_сохраняется_и_удаляется_из_избранного() {
    let (path, _restore) = config::test_path::temp_config("fingerprint");
    let mut config = AppConfig::default();
    config.favorites = vec![SshConfig {
        id: Some("srv-1".to_owned()),
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        ..SshConfig::default()
    }];
    config::save(&config).expect("стартовый конфиг");

    let target = config.favorites[0].clone();
    let fingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    // Подтверждение: отпечаток появляется в блоке сервера.
    config::set_favorite_fingerprint(&target, fingerprint)
        .await
        .expect("сохранить отпечаток");
    let stored = config::load();
    assert_eq!(
        stored.favorites[0].fingerprint.as_deref(),
        Some(fingerprint),
        "подтверждённый отпечаток не попал в избранное"
    );

    // Снимок рендерера отпечатка не содержит — сохранение не должно его терять.
    let mut snapshot = config::load();
    snapshot.theme = "Light".to_owned();
    snapshot.favorites[0].fingerprint = None;
    config::preserve_fingerprints(&mut snapshot);
    assert_eq!(
        snapshot.favorites[0].fingerprint.as_deref(),
        Some(fingerprint),
        "сохранение настроек стёрло подтверждённый отпечаток"
    );

    // Удаление: значение действительно исчезает из конфигурации.
    config::clear_favorite_fingerprint("srv-1")
        .await
        .expect("удалить отпечаток");
    let cleared = config::load();
    assert!(
        cleared.favorites[0].fingerprint.is_none(),
        "отпечаток остался в конфиге после удаления"
    );
    assert!(
        !std::fs::read_to_string(&path).unwrap_or_default().contains("SHA256:"),
        "удалённый отпечаток остался в файле конфига"
    );

    // После удаления повторное сохранение снимка рендерера отпечаток не вернёт:
    // в кэше его больше нет, значит источник истины — снимок.
    let mut after_delete = config::load();
    after_delete.theme = "Dark".to_owned();
    config::preserve_fingerprints(&mut after_delete);
    assert!(after_delete.favorites[0].fingerprint.is_none());

    let _ = std::fs::remove_file(&path);
}

/// Отпечаток сервера без `id` сохранить некуда: подтверждение должно честно
/// сообщить об ошибке, а не записать значение мимо конфига.
#[tokio::test]
async fn отпечаток_сервера_без_id_не_сохраняется() {
    let (_path, _restore) = config::test_path::temp_config("fingerprint-no-id");
    config::save(&AppConfig::default()).expect("стартовый конфиг");

    let anonymous = SshConfig {
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        ..SshConfig::default()
    };

    let result = config::set_favorite_fingerprint(&anonymous, "SHA256:test").await;
    assert!(result.is_err(), "отпечаток сохранён для сервера без id");
    assert!(config::load().favorites.is_empty());

    // Подключение такого сервера тоже идёт без отпечатка: подтверждать его
    // всё равно некому, поэтому вопрос показать негде.
    assert!(config::with_stored_fingerprint(&anonymous).fingerprint.is_none());
}

/// Копия сервера получает новый `id`, поэтому отпечаток исходного к ней не
/// относится и подтверждается заново.
#[tokio::test]
async fn копия_сервера_не_наследует_отпечаток() {
    let (path, _restore) = config::test_path::temp_config("fingerprint-copy");
    let mut config = AppConfig::default();
    config.favorites = vec![SshConfig {
        id: Some("srv-1".to_owned()),
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        fingerprint: Some("SHA256:оригинала".to_owned()),
        ..SshConfig::default()
    }];
    config::save(&config).expect("стартовый конфиг");

    let copy = SshConfig {
        id: Some("srv-2".to_owned()),
        name: "server - copy".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        fingerprint: Some("SHA256:оригинала".to_owned()),
        ..SshConfig::default()
    };

    assert!(
        config::with_stored_fingerprint(&copy).fingerprint.is_none(),
        "копия сервера унаследовала отпечаток, хотя у неё свой id"
    );
    let _ = std::fs::remove_file(&path);
}

/// Перед подключением отпечаток берётся из main-процесса, а не из снимка
/// рендерера.
///
/// Снимок опасен в обе стороны: устаревший отпечаток заставил бы принять ключ,
/// который пользователь уже удалил, а отсутствующий — задавать лишний вопрос при
/// каждом подключении.
#[test]
fn отпечаток_для_подключения_берётся_из_хранилища() {
    let (path, _restore) = config::test_path::temp_config("fingerprint-resolve");
    let mut config = AppConfig::default();
    config.favorites = vec![SshConfig {
        id: Some("srv-1".to_owned()),
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        fingerprint: Some("SHA256:сохранённый".to_owned()),
        ..SshConfig::default()
    }];
    config::save(&config).expect("стартовый конфиг");

    // Снимок рендерера отпечатка не знает — значение всё равно подставляется.
    let from_snapshot = config::with_stored_fingerprint(&SshConfig {
        id: Some("srv-1".to_owned()),
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        fingerprint: None,
        ..SshConfig::default()
    });
    assert_eq!(
        from_snapshot.fingerprint.as_deref(),
        Some("SHA256:сохранённый"),
        "подключение не получило сохранённый отпечаток и спросило бы заново"
    );

    // Снимок с чужим отпечатком игнорируется: источник истины — конфиг.
    let stale = config::with_stored_fingerprint(&SshConfig {
        id: Some("srv-1".to_owned()),
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        fingerprint: Some("SHA256:устаревший".to_owned()),
        ..SshConfig::default()
    });
    assert_eq!(stale.fingerprint.as_deref(), Some("SHA256:сохранённый"));

    // Удалённый отпечаток не воскрешается из снимка вкладки.
    config::clear_favorite_fingerprint_sync("srv-1");
    let after_delete = config::with_stored_fingerprint(&stale);
    assert!(
        after_delete.fingerprint.is_none(),
        "удалённый отпечаток вернулся из снимка рендерера"
    );

    let _ = std::fs::remove_file(&path);
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
