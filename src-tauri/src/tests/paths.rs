use super::*;

#[test]
fn uuid_имеет_нужную_форму() {
    let value = new_uuid();
    assert_eq!(value.len(), 36);
    assert_eq!(value.as_bytes()[14], b'4');
    assert_ne!(value, new_uuid());
}

#[test]
fn platform_известен() {
    assert!(!platform_id().is_empty());
}

/// Имя файла конфига менять нельзя: от него зависят перенос данных с
/// Electron-версии и совместимость бэкапов.
#[test]
fn имя_файла_конфига_совпадает_с_прежней_версией() {
    assert_eq!(CONFIG_FILE_NAME, ".minissh_config.json");
    assert_eq!(UPDATER_STATE_FILE_NAME, ".minissh_updater.json");
    // Идентификаторы хранилища секретов тоже привязаны к установленному
    // приложению: смена значения заставило бы вводить ключ заново.
    assert_eq!(KEYCHAIN_SERVICE, "com.yash.client");
    assert_eq!(KEYCHAIN_USER, "vault-recovery-key");
}

#[test]
fn конфиг_лежит_в_домашнем_каталоге() {
    let Some(home) = home_dir() else { return };
    assert_eq!(config_dir().as_ref(), Some(&home));
    assert_eq!(config_path(), Some(home.join(CONFIG_FILE_NAME)));
    assert_eq!(updater_state_path(), Some(home.join(UPDATER_STATE_FILE_NAME)));
}

#[test]
fn uuid_уникален_подряд() {
    // `clientId` и id сессий строятся на этом: совпадение сломало бы
    // привязку секретов к серверам.
    let mut values = std::collections::HashSet::new();
    for _ in 0..64 {
        assert!(values.insert(new_uuid()), "UUID повторился");
    }
}

#[test]
fn случайные_строки_имеют_ожидаемую_длину() {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    for len in [16usize, 32, 48] {
        let value = random_base64(len);
        let decoded = STANDARD.decode(&value).expect("base64");
        assert_eq!(decoded.len(), len);
    }
    assert_ne!(random_base64(32), random_base64(32));
}

#[test]
fn дайджест_заполняет_буфер_любой_длины() {
    // Резервный источник энтропии: цикл по `index % len` обязан покрыть
    // буфер целиком, иначе в ключе появятся нули.
    let digest = simple_digest(b"seed");
    assert_eq!(digest.len(), 32);
    assert!(digest.iter().any(|byte| *byte != 0));
    assert_eq!(simple_digest(b"seed"), digest);
    assert_ne!(simple_digest(b"other"), digest);
}

#[test]
fn версия_ос_не_пустая() {
    // Значение уходит в заголовок экспорта логов.
    assert!(!os_release().is_empty());
}
