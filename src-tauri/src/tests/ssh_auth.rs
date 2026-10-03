use super::*;

/// Базовая подключка для тестов.
///
/// `user` намеренно не задан жёстко: при `user: "root"` рядом с `..partial`
/// поле из аргумента не применилось бы вовсе, и тест на пустой логин всегда
/// получал бы «root».
fn config(partial: SshConfig) -> SshConfig {
    SshConfig {
        name: "server".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        ..partial
    }
}

/// Открывает хранилище на время теста.
///
/// Возвращаемый guard надо держать до конца теста: мастер-ключ в приложении
/// один, а тесты идут параллельно.
fn unlocked_vault() -> parking_lot::MutexGuard<'static, ()> {
    let guard = crate::vault::test_guard();
    let _ = crate::vault::unlock(
        &crate::paths::random_base64(32),
        &crate::paths::random_base64(16),
    );
    guard
}

#[test]
fn пустой_логин_требует_ввода() {
    assert!(is_login_required(&config(SshConfig { user: String::new(), ..SshConfig::default() })));
    assert!(is_login_required(&config(SshConfig { user: "   ".to_owned(), ..SshConfig::default() })));
    assert!(!is_login_required(&config(SshConfig { user: "root".to_owned(), ..SshConfig::default() })));
}

#[test]
fn без_пароля_и_ключа_план_пустой() {
    let _vault = unlocked_vault();
    let plan = build_auth_plan(&config(SshConfig::default()), &SessionAuth::default()).expect("plan");
    assert!(matches!(plan, AuthPlan::Password(None)));
}

#[test]
fn пароль_из_сессии_важнее_сохранённого() {
    let _vault = unlocked_vault();
    let session = SessionAuth { password: Some("session".to_owned()), ..SessionAuth::default() };
    let plan = build_auth_plan(&config(SshConfig::default()), &session).expect("plan");
    match plan {
        AuthPlan::Password(value) => assert_eq!(value.as_deref(), Some("session")),
        other => panic!("unexpected plan: {other:?}"),
    }
}

#[test]
fn ключевой_метод_без_ключа_даёт_missing() {
    let _vault = unlocked_vault();
    let err = build_auth_plan(
        &config(SshConfig { auth_type: Some("key".to_owned()), ..SshConfig::default() }),
        &SessionAuth::default(),
    )
    .expect_err("missing");
    assert_eq!(err.failure, PrivateKeyFailure::Missing);
}

/// blob, который не расшифровывается: тег не сойдётся.
fn broken_secret() -> EncryptedSecret {
    let mut secret = crate::vault::encrypt("payload").expect("encrypt");
    let mut data = secret.data.clone().into_bytes();
    // Меняем символ в середине base64: длина и алфавит остаются валидными,
    // но расшифровка провалится.
    let position = 1;
    data[position] = if data[position] == b'A' { b'B' } else { b'A' };
    secret.data = String::from_utf8(data).expect("base64");
    secret
}

#[test]
fn введённый_ключ_важнее_введённого_пароля() {
    let _vault = unlocked_vault();
    let session = SessionAuth {
        // Содержимое заведомо не ключ: важно, что выбрана ключевая ветка.
        // Парольная вернула бы `Ok`, поэтому любая ошибка доказывает
        // приоритет ключа.
        private_key: Some(crate::vault::encrypt("not a key").expect("encrypt")),
        password: Some("pw".to_owned()),
        ..SessionAuth::default()
    };
    let plan = build_auth_plan(
        &config(SshConfig { auth_type: Some("password".to_owned()), ..SshConfig::default() }),
        &session,
    );
    assert!(plan.is_err(), "ключ из сессии должен побеждать пароль: {plan:?}");
}

#[test]
fn ошибка_расшифровки_введённого_ключа_не_становится_паролем() {
    let _vault = unlocked_vault();
    let session = SessionAuth {
        private_key: Some(broken_secret()),
        password: Some("pw".to_owned()),
        ..SessionAuth::default()
    };
    let err = build_auth_plan(&config(SshConfig::default()), &session).expect_err("decrypt");
    assert_eq!(err.failure, PrivateKeyFailure::Decrypt);
}

#[test]
fn неизвестный_тип_авторизации_считается_паролем() {
    let _vault = unlocked_vault();
    let plan = build_auth_plan(
        &config(SshConfig { auth_type: Some("телепатия".to_owned()), ..SshConfig::default() }),
        &SessionAuth::default(),
    )
    .expect("plan");
    assert!(matches!(plan, AuthPlan::Password(None)));
}

#[test]
fn известный_пароль_берётся_из_сессии_или_конфига() {
    let _vault = unlocked_vault();
    assert_eq!(
        known_password(&config(SshConfig::default()), &SessionAuth::default()),
        None,
        "без ввода и без хранилища пароля спрашивать нечего"
    );

    let session = SessionAuth { password: Some("session".to_owned()), ..SessionAuth::default() };
    assert_eq!(
        known_password(&config(SshConfig::default()), &session).as_deref(),
        Some("session")
    );
}

/// Keyboard-interactive берёт пароль из готового плана, а не читает системное
/// хранилище заново. Инвариант: план содержит ровно то, что вернул бы
/// [`known_password`] для того же сервера и сессии, — иначе сервер получил бы не
/// тот пароль, который сохранён в конфиге.
#[test]
fn пароль_из_плана_совпадает_с_известным() {
    let _vault = unlocked_vault();
    let config = config(SshConfig::default());

    let session = SessionAuth::default();
    let plan = build_auth_plan(&config, &session).expect("plan");
    assert_eq!(plan.saved_password(), known_password(&config, &session));

    // Введённый в этой сессии пароль приоритетнее сохранённого, и план знает
    // о нём без чтения хранилища.
    let session = SessionAuth { password: Some("session".to_owned()), ..SessionAuth::default() };
    let plan = build_auth_plan(&config, &session).expect("plan");
    assert_eq!(plan.saved_password().as_deref(), Some("session"));
    assert_eq!(plan.saved_password(), known_password(&config, &session));
}

#[test]
fn смена_хеш_алгоритма_не_ломает_парольный_план() {
    let plan = AuthPlan::Password(Some("pw".to_owned()));
    match with_server_hash_alg(plan, Ok(Some(Some(HashAlg::Sha256)))) {
        AuthPlan::Password(value) => assert_eq!(value.as_deref(), Some("pw")),
        other => panic!("unexpected plan: {other:?}"),
    }
}
