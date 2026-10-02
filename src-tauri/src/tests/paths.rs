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

/// Версия ОС уходит в заголовок экспорта логов: пустой строки там быть не
/// должно. Само отсутствие версии — не ошибка (тогда скобки опускаются), но
/// на Linux и Windows она обязана определяться, иначе в логах снова появится
/// заглушка вместо диагностической информации.
#[test]
fn версия_ос_либо_известна_либо_отсутствует() {
    if let Some(release) = os_release() {
        assert!(
            !release.trim().is_empty(),
            "в заголовок логов попадёт пустая версия ОС"
        );
    }

    if cfg!(any(target_os = "linux", target_os = "android", target_os = "windows")) {
        assert!(
            os_release().is_some(),
            "версия ОС должна определяться на этой платформе"
        );
    }

    // Версия — строка из цифр и точек, иначе в заголовок может попасть
    // мусор из файла или вывода системной команды.
    if let Some(release) = os_release() {
        assert!(
            release
                .chars()
                .all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '-' | '_')),
            "неожиданный формат версии ОС: {release:?}"
        );
    }
}
