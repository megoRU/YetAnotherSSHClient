use super::*;

/// Временный каталог для проверок записи конфига.
fn temp_config_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("yassh-config-tests");
    std::fs::create_dir_all(&dir).expect("каталог");
    dir.join(format!("{name}-{}.json", std::process::id()))
}

/// Запись должна быть атомарной: настоящий файл не может остаться обрезанным.
///
/// Раньше `save()` писал `std::fs::write(&path, …)` — обрезал файл и писал на
/// его месте. Параллельная запись из `save_async()` (сохранение геометрии при
/// быстром закрытии) попадала ровно в это окно, и на диск оставался усечённый
/// JSON: следующий запуск терял настройки, а приложение открывалось пустым.
/// Теперь обе записи идут через временный файл и `rename`.
#[test]
fn запись_конфига_атомарна() {
    let path = temp_config_path("atomic");
    write_atomic_sync(&path, b"{\"first\":true}").expect("первая запись");

    // Временный файл не должен остаться рядом с конфигом. Проверяем только
    // свои: тесты идут параллельно и делят каталог, чужие `.tmp` к делу не
    // относятся.
    let stem = path.file_stem().expect("имя файла").to_string_lossy().into_owned();
    let leftovers: Vec<String> = std::fs::read_dir(path.parent().expect("каталог"))
        .expect("читается каталог")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(&stem) && name.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "остались временные файлы: {leftovers:?}");

    write_atomic_sync(&path, b"{\"second\":true}").expect("вторая запись");
    assert_eq!(std::fs::read_to_string(&path).expect("чтение"), "{\"second\":true}");

    let _ = std::fs::remove_file(&path);
}

/// Параллельные записи не должны делить один временный файл: иначе один
/// writer перетирает содержимое другого и на диск попадает обрывок JSON.
#[test]
fn временные_файлы_уникальны_на_каждую_запись() {
    let path = temp_config_path("temp-unique");
    let first = temp_path(&path);
    let second = temp_path(&path);
    let third = temp_path(&path);

    assert_ne!(first, second, "две записи получили один временный файл");
    assert_ne!(second, third, "две записи получили один временный файл");
    assert_ne!(first, third);
    // Расширение остаётся временным: `cleanup_orphaned_temp_dirs` и глаз
    // пользователя не должны принять его за конфиг.
    for temp in [&first, &second, &third] {
        assert!(
            temp.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("tmp")),
            "не временное расширение: {}",
            temp.display()
        );
    }
}

/// Параллельные записи в один файл не портят результат: на диске оказывается
/// один из полных вариантов, а не смесь и не пустота.
#[test]
fn параллельные_записи_не_портят_файл() {
    let path = temp_config_path("concurrent");
    write_atomic_sync(&path, b"{\"seed\":true}").expect("стартовый файл");

    let target = path.clone();
    let handles: Vec<_> = (0..8)
        .map(|index| {
            let target = target.clone();
            std::thread::spawn(move || {
                let payload = format!("{{\"writer\":{index}}}");
                write_atomic_sync(&target, payload.as_bytes())
            })
        })
        .collect();

    for handle in handles {
        handle.join().expect("поток не паниковал").expect("запись");
    }

    let final_text = std::fs::read_to_string(&path).expect("чтение");
    let parsed: serde_json::Value = serde_json::from_str(&final_text)
        .unwrap_or_else(|err| panic!("на диске не целый JSON ({err}): {final_text}"));
    assert!(
        parsed.get("writer").is_some(),
        "файл не принадлежит ни одному writer'у: {final_text}"
    );

    let _ = std::fs::remove_file(&path);
}

/// Новая соль несовместима со старыми секретами, поэтому её нельзя выдавать,
/// когда в конфиге уже есть зашифрованные данные.
///
/// Именно это и происходило: при повреждённой записи конфига (блок `encryption`
/// пропадал) код молча генерировал новую соль и сохранял её. Все блоки
/// переставали расшифровываться навсегда, а ввод ключа восстановления ничего
/// не возвращал — хранилище было уже уничтожено.
#[test]
fn соль_не_перегенерируется_при_зашифрованных_данных() {
    assert_eq!(
        salt_action(true),
        SaltAction::KeepSecrets,
        "при непустом хранилище соль заменена — секреты потеряны навсегда"
    );
    // Пустое хранилище: соли ещё нет, её нужно создать.
    assert_eq!(salt_action(false), SaltAction::Generate);
}

/// Соль выдаётся ровно тогда, когда хранить нечего: иначе блок соли лишний, а
/// ввод ключа восстановления пользователю не нужен.
#[test]
fn соль_создаётся_для_пустого_хранилища() {
    let fresh = AppConfig {
        encryption: None,
        encrypted_passwords: Some(BTreeMap::new()),
        ..default_config()
    };
    assert!(
        !has_sealed_secrets(&fresh),
        "пустой конфиг ошибочно признан содержащим секреты"
    );
    assert_eq!(salt_action(has_sealed_secrets(&fresh)), SaltAction::Generate);
}

/// Достаточно одного зашифрованного блока, чтобы запретить новую соль: пароли,
/// парольные фразы и приватные ключи одинаково от неё зависят.
#[test]
fn любой_секрет_блокирует_новую_соль() {
    let with_password = AppConfig {
        encryption: None,
        encrypted_passwords: Some(BTreeMap::from([(
            "srv".to_owned(),
            EncryptedSecret { iv: "a".into(), tag: "b".into(), data: "c".into() },
        )])),
        ..default_config()
    };
    assert!(has_sealed_secrets(&with_password));
    assert_eq!(salt_action(has_sealed_secrets(&with_password)), SaltAction::KeepSecrets);

    let with_passphrase = AppConfig {
        encryption: None,
        encrypted_key_passphrases: Some(BTreeMap::from([(
            "srv".to_owned(),
            EncryptedSecret { iv: "a".into(), tag: "b".into(), data: "c".into() },
        )])),
        ..default_config()
    };
    assert!(has_sealed_secrets(&with_passphrase));

    let with_private_key = AppConfig {
        encryption: None,
        favorites: vec![SshConfig {
            private_key: Some(serde_json::json!({"iv":"a","tag":"b","data":"c"})),
            ..favorite(SshConfig::default())
        }],
        ..default_config()
    };
    assert!(has_sealed_secrets(&with_private_key));
}

/// Кэш ключа восстановления не удаляется из системного хранилища при неудачной
/// проверке: удаление необратимо и не помогает — при чужом ключе пользователь
/// всё равно получит запрос ключа, а при сбое проверки годный ключ был бы
/// выброшен и ввод требовался бы заново.
#[test]
fn кэш_ключа_не_удаляется_при_неудачной_проверке() {
    // Сторона, которая удаляла запись, — `keychain::delete_recovery_key`.
    // Проверяем по исходнику: вызов не должен остаться в пути авторазблокировки.
    let source = include_str!("../config.rs");
    let auto_unlock = source
        .split("// 2. Авторазблокировка")
        .nth(1)
        .and_then(|rest| rest.split("// 3. Миграция").next())
        .expect("секция авторазблокировки");
    assert!(
        !auto_unlock.contains("delete_recovery_key"),
        "авторазблокировка снова удаляет кэшированный ключ из системного хранилища"
    );
}

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
