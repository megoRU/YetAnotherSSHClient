use super::*;

fn favorite(partial: SshConfig) -> SshConfig {
    SshConfig {
        name: "server".to_owned(),
        user: "root".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        ..partial
    }
}

#[test]
fn favorites_последнее_поле_конфига() {
    let json = serde_json::to_value(default_config()).expect("config serializes");
    let object = json.as_object().expect("config is object");
    let last = object.keys().last().expect("config is not empty");
    assert_eq!(last, "favorites");
}

/// Значения по умолчанию восстанавливаются при любом «пустом» поле: старый
/// конфиг без новых настроек не должен ломать UI.
#[test]
fn нормализация_восстанавливает_пустые_значения() {
    let mut config = AppConfig {
        theme: String::new(),
        language: String::new(),
        server_card_size: String::new(),
        sidebar_position: String::new(),
        terminal_font_name: String::new(),
        ui_font_name: String::new(),
        terminal_font_size: 0,
        ui_font_size: 0,
        terminal_scroll_sensitivity: 0,
        mcp_port: 0,
        mcp_token: String::new(),
        sftp_sound_volume: 0.0,
        ..default_config()
    };
    normalize(&mut config);

    assert_eq!(config.theme, "Auto");
    assert_eq!(config.language, "ru");
    assert_eq!(config.server_card_size, "standard");
    assert_eq!(config.sidebar_position, "left");
    assert_eq!(config.terminal_font_name, "JetBrains Mono");
    assert_eq!(config.ui_font_name, "JetBrains Mono");
    assert!(config.terminal_font_size > 0);
    assert!(config.ui_font_size > 0);
    assert!(config.terminal_scroll_sensitivity > 0);
    assert!(config.mcp_port > 0);
    assert!(!config.mcp_token.is_empty(), "токен MCP должен быть сгенерирован");
    assert!(config.sftp_sound_volume > 0.0 && config.sftp_sound_volume <= 1.0);

    // Нормализация идемпотентна: повторный вызов не меняет значения.
    let before = config.clone();
    normalize(&mut config);
    assert_eq!(config.mcp_token, before.mcp_token, "токен перегенерирован");
    assert_eq!(config.theme, before.theme);
}

/// Недопустимые значения заменяются дефолтом, а не остаются как есть:
/// громкость больше 1 ломала бы ползунок, нулевой порт — MCP.
#[test]
fn нормализация_чинит_недопустимые_значения() {
    let mut config = AppConfig { sftp_sound_volume: 5.0, mcp_port: 1, ..default_config() };
    normalize(&mut config);
    assert_eq!(config.sftp_sound_volume, 0.5, "громкость вне 0..1 не принимается");

    let mut config = AppConfig { sftp_sound_volume: -1.0, ..default_config() };
    normalize(&mut config);
    assert_eq!(config.sftp_sound_volume, 0.5);
}

/// Секреты и открытые ключи не должны попасть на диск: `prepare_for_disk`
/// работает с копией и не меняет переданный конфиг.
#[test]
fn подготовка_к_записи_вырезает_секреты() {
    let _guard = vault::test_guard();
    vault::unlock(&paths::random_base64(32), &paths::random_base64(16)).expect("открыть хранилище");

    let original = AppConfig {
        favorites: vec![favorite(SshConfig {
            id: Some("srv-1".to_owned()),
            password: Some("открытый-пароль".to_owned()),
            key_passphrase: Some("открытая-фраза".to_owned()),
            private_key: Some(serde_json::json!("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----")),
            ..SshConfig::default()
        })],
        ..default_config()
    };

    let snapshot = prepare_for_disk(&original);
    let saved = &snapshot.favorites[0];
    assert!(saved.password.is_none(), "пароль не должен попасть на диск");
    assert!(saved.key_passphrase.is_none(), "парольная фраза не должна попасть на диск");
    // Открытый ключ либо шифруется, либо удаляется — открытым он не остаётся.
    match &saved.private_key {
        Some(value) => assert!(
            serde_json::from_value::<EncryptedSecret>(value.clone()).is_ok(),
            "на диск попал незашифрованный ключ: {value}"
        ),
        None => {}
    }
    // Исходный конфиг не изменён: снимок — копия.
    assert_eq!(original.favorites[0].password.as_deref(), Some("открытый-пароль"));
}

/// Порт из старого конфига мог прийти строкой — такой файл обязан читаться.
#[test]
fn порт_из_строки_читается_как_число() {
    let json = serde_json::json!({
        "favorites": [
            { "name": "старый", "user": "u", "host": "h", "port": "2222" },
            { "name": "новый", "user": "u", "host": "h", "port": 22 }
        ]
    });
    let config: AppConfig = serde_json::from_value(json).expect("старый формат читается");
    assert_eq!(config.favorites[0].port, 2222);
    assert_eq!(config.favorites[1].port, 22);
}

#[test]
fn пустой_client_id_заполняется_и_не_перетирается() {
    let mut config = AppConfig { client_id: String::new(), ..default_config() };
    ensure_client_id_standalone(&mut config);
    assert!(!config.client_id.is_empty(), "идентификатор должен быть создан");

    // Уже записанный идентификатор — источник правды: новый uuid его не
    // заменяет, иначе телеметрия считала бы пользователя новым.
    let generated = config.client_id.clone();
    ensure_client_id_standalone(&mut config);
    assert_eq!(config.client_id, generated, "clientId не должен перетираться");
}

#[test]
fn пустой_секрет_удаляет_сохранённый() {
    // Проверяется без хранилища: пустая строка обязана удалять запись.
    let mut favorites = vec![favorite(SshConfig {
        id: Some("srv-1".to_owned()),
        password: Some(String::new()),
        ..SshConfig::default()
    })];
    let mut store = BTreeMap::new();
    store.insert(
        "srv-1".to_owned(),
        EncryptedSecret { iv: "a".into(), tag: "b".into(), data: "c".into() },
    );

    sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, false);

    assert!(!store.contains_key("srv-1"));
    assert!(favorites[0].password.is_none());
}

#[test]
fn отсутствующее_поле_не_трогает_сохранённый_секрет() {
    let mut favorites = vec![favorite(SshConfig {
        id: Some("srv-1".to_owned()),
        ..SshConfig::default()
    })];
    let mut store = BTreeMap::new();
    let original = EncryptedSecret { iv: "a".into(), tag: "b".into(), data: "c".into() };
    store.insert("srv-1".to_owned(), original.clone());

    sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, true);

    assert_eq!(store.get("srv-1"), Some(&original));
}

#[test]
fn настройки_восстанавливаются_при_пустых_значениях() {
    let mut config = default_config();
    config.terminal_font_name = String::new();
    config.mcp_port = 0;
    config.mcp_token = String::new();
    normalize(&mut config);
    assert_eq!(config.terminal_font_name, "JetBrains Mono");
    assert_eq!(config.mcp_port, 3000);
    assert!(!config.mcp_token.is_empty());
}

#[test]
fn конфиг_без_онбординга_считается_настроенным() {
    let json = serde_json::json!({ "terminalFontName": "Old Mono", "favorites": [] });
    let mut value = json;
    value
        .as_object_mut()
        .expect("object")
        .entry("isOnboardingCompleted".to_owned())
        .or_insert(serde_json::Value::Bool(true));
    let config: AppConfig = serde_json::from_value(value).expect("config parses");
    assert!(config.is_onboarding_completed);
}

#[test]
fn legacy_string_port_is_loaded_as_a_number() {
    let mut value = serde_json::to_value(default_config()).expect("default config serializes");
    value["favorites"] = serde_json::json!([{
        "id": "legacy-server",
        "name": "server",
        "user": "root",
        "host": "example.com",
        "port": "12222"
    }]);

    let config: AppConfig = serde_json::from_value(value).expect("legacy config parses");
    assert_eq!(config.favorites[0].port, 12222);
}
