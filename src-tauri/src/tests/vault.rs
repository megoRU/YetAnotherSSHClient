use super::*;

fn fresh_key() -> (String, String) {
    (
        crate::paths::random_base64(32),
        crate::paths::random_base64(16),
    )
}

/// Мастер-ключ в приложении один, поэтому тесты обязаны открывать
/// хранилище по очереди: иначе соседний тест переоткроет его своим
/// ключом и расшифровка чужого секрета провалится.
fn unlocked() -> parking_lot::MutexGuard<'static, ()> {
    let guard = crate::vault::test_guard();
    let (key, salt) = fresh_key();
    unlock(&key, &salt).expect("unlock");
    guard
}

#[test]
fn round_trip_и_уникальность_iv() {
    let _guard = unlocked();

    let secret = encrypt("секрет").expect("encrypt");
    assert_eq!(decrypt(&secret).expect("decrypt"), "секрет");

    let again = encrypt("секрет").expect("encrypt");
    assert_ne!(secret.iv, again.iv);
    assert_eq!(decrypt(&again).expect("decrypt"), "секрет");
}

#[test]
fn закрытое_хранилище_отклоняет_операции() {
    let _guard = unlocked();
    let secret = encrypt("секрет").expect("encrypt");
    lock();
    assert!(!is_unlocked());
    assert_eq!(encrypt("x").unwrap_err(), LOCKED);
    assert_eq!(decrypt(&secret).unwrap_err(), LOCKED);
}

#[test]
fn подмена_данных_обнаруживается() {
    let _guard = unlocked();
    let secret = encrypt("секрет").expect("encrypt");

    // Подмена любой части blob обязана ломать расшифровку: тег AEAD
    // покрывает и текст, и IV.
    let mut tampered = secret.clone();
    tampered.tag = crate::paths::random_base64(16);
    assert!(decrypt(&tampered).is_err(), "подмена тега не замечена");

    let mut tampered = secret.clone();
    tampered.data = crate::paths::random_base64(16);
    assert!(decrypt(&tampered).is_err(), "подмена шифротекста не замечена");

    let mut tampered = secret.clone();
    tampered.iv = crate::paths::random_base64(16);
    assert!(decrypt(&tampered).is_err(), "подмена IV не замечена");
}

#[test]
fn чужой_ключ_не_расшифровывает() {
    let _guard = crate::vault::test_guard();
    let (key, salt) = fresh_key();
    let (other_key, _) = fresh_key();

    unlock(&key, &salt).expect("unlock");
    let secret = encrypt("секрет").expect("encrypt");

    unlock(&other_key, &salt).expect("unlock");
    assert!(decrypt(&secret).is_err());
}

/// Соль и ключ восстановления задают мастер-ключ, поэтому неверная соль
/// при том же ключе тоже не должна давать доступ к данным.
#[test]
fn неверная_соль_не_расшифровывает() {
    let _guard = crate::vault::test_guard();
    let (key, salt) = fresh_key();
    let (_, other_salt) = fresh_key();

    unlock(&key, &salt).expect("unlock");
    let secret = encrypt("секрет").expect("encrypt");

    unlock(&key, &other_salt).expect("unlock");
    assert!(decrypt(&secret).is_err());
}

/// Неверные входные данные ключа отвергаются явной ошибкой, а не паникой:
/// ключ вводит пользователь.
#[test]
fn некорректный_ключ_отвергается() {
    let _guard = crate::vault::test_guard();
    lock();
    assert!(unlock("не-base64!!", &crate::paths::random_base64(16)).is_err());
    assert!(unlock(&crate::paths::random_base64(32), "не-base64!!").is_err());
    assert!(unlock("", &crate::paths::random_base64(16)).is_err());
    assert!(!is_unlocked(), "после неудач открытия хранилище должно остаться закрытым");
}

/// Пустой секрет — допустимое значение (пароль может быть пустым), но
/// структура blob обязана остаться корректной.
#[test]
fn пустой_секрет_шифруется_и_читается() {
    let _guard = unlocked();
    let secret = encrypt("").expect("encrypt");
    assert_eq!(decrypt(&secret).expect("decrypt"), "");
}
