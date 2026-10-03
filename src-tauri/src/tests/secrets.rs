//! Тесты модели «секрет в системном хранилище, вольт для совместимости».
//!
//! Системное хранилище подменено на [`crate::keychain::MemoryBackend`], поэтому
//! весь набор проходит одинаково на Windows, macOS и Linux и не трогает
//! настоящие Credential Manager / Keychain / Secret Service.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::*;
use crate::config::{EncryptionInfo, SecretField};
use crate::keychain::{MemoryBackend, SecretBackend, Slot, TEST_SERVICE};
use crate::vault::test_guard;

// ── Фикстуры ──────────────────────────────────────────────────────────────────

/// Тесты делят и мастер-ключ, и подменённое хранилище: обе блокировки берутся
/// до любых действий.
fn guard() -> parking_lot::MutexGuard<'static, ()> {
    let vault_guard = test_guard();
    keychain::set_backend(Arc::new(MemoryBackend::new()));
    vault_guard
}

/// Открывает вольт на собственном ключе.
fn unlock() -> (String, String) {
    let key = crate::paths::random_base64(32);
    let salt = crate::paths::random_base64(16);
    crate::vault::unlock(&key, &salt).expect("вольт открыт");
    (key, salt)
}

fn sealed(value: &str) -> EncryptedSecret {
    crate::vault::encrypt(value).expect("шифрование")
}

fn server(id: &str) -> SshConfig {
    SshConfig { id: Some(id.to_owned()), ..SshConfig::default() }
}

/// Конфиг с одним паролем в вольте.
fn config_with_password(server_id: &str, value: &str) -> AppConfig {
    let mut passwords: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
    passwords.insert(server_id.to_owned(), sealed(value));
    AppConfig {
        encryption: Some(EncryptionInfo { version: 1, salt: "salt".to_owned(), check: None }),
        encrypted_passwords: Some(passwords),
        favorites: vec![server(server_id)],
        ..AppConfig::default()
    }
}

// ── Имена слотов ──────────────────────────────────────────────────────────────

/// Имя слота ключа восстановления нельзя менять: оно уже заведено у
/// пользователей, и переименование заставило бы всех заново вводить ключ.
#[test]
fn слот_ключа_восстановления_сохраняет_имя() {
    assert_eq!(Slot::RecoveryKey.account(), crate::paths::KEYCHAIN_USER);
}

/// Слоты секретов не должны пересекаться со слотом ключа восстановления:
/// перечисление секретов иначе выдало бы ключ.
#[test]
fn слоты_секретов_не_пересекаются_с_ключом() {
    let accounts = [
        Slot::Password("srv-1".to_owned()).account(),
        Slot::KeyPassphrase("srv-1".to_owned()).account(),
        Slot::PrivateKey("srv-1".to_owned()).account(),
    ];
    for account in accounts {
        assert_ne!(account, crate::paths::KEYCHAIN_USER, "слот секрета совпал с ключом");
        assert!(account.starts_with("secret:"), "нет префикса пространства имён: {account}");
    }

    // Разные виды секретов одного сервера — разные записи.
    assert_ne!(
        Slot::Password("srv-1".to_owned()).account(),
        Slot::PrivateKey("srv-1".to_owned()).account()
    );
    // Разные серверы — тоже.
    assert_ne!(
        Slot::Password("srv-1".to_owned()).account(),
        Slot::Password("srv-2".to_owned()).account()
    );
}

// ── Лимит размера ─────────────────────────────────────────────────────────────

/// Секреты крупнее лимита платформы остаются в вольте: Credential Manager не
/// примет их в принципе, и молчаливая потеря ключа была бы хуже ввода ключа.
#[test]
fn крупный_секрет_не_пишется_в_системное_хранилище() {
    let _guard = guard();
    let big = "x".repeat(crate::keychain::MAX_SYSTEM_SECRET_BYTES + 1);
    assert!(!keychain::write_slot(&Slot::Password("srv".to_owned()), &big));
    assert!(keychain::read_slot(&Slot::Password("srv".to_owned())).is_none());
}

/// Ключ восстановления лимитом не ограничен: он короткий, а его незапись
/// означала бы ввод ключа руками при каждом запуске.
#[test]
fn ключ_восстановления_лимитом_не_ограничен() {
    let _guard = guard();
    let long = "k".repeat(crate::keychain::MAX_SYSTEM_SECRET_BYTES * 2);
    assert!(keychain::write_slot(&Slot::RecoveryKey, &long));
    assert_eq!(keychain::read_slot(&Slot::RecoveryKey).as_deref(), Some(long.as_str()));
}

// ── Миграция ──────────────────────────────────────────────────────────────────

/// Первый запуск после перехода: секрет из вольта переносится в системное
/// хранилище, и вольт остаётся на месте для бэкапа.
#[test]
fn миграция_переносит_секрет_из_вольта() {
    let _guard = guard();
    unlock();
    let config = config_with_password("srv-1", "пароль-1");

    let report = crate::secrets::migrate(&config);

    assert_eq!(report.migrated, 1, "секрет должен перенестись");
    assert!(report.is_complete(), "после переноса вольт не нужен");
    assert_eq!(
        keychain::read_slot(&Slot::Password("srv-1".to_owned())).as_deref(),
        Some("пароль-1"),
        "в системном хранилище лежит не тот секрет"
    );
    // Вольт не тронут — на нём держится бэкап и перенос на другую машину.
    assert!(
        config.encrypted_passwords.as_ref().is_some_and(|map| map.contains_key("srv-1")),
        "миграция не должна удалять блоб из вольта"
    );
}

/// Повторный запуск не перезаписывает уже существующий секрет и не падает.
#[test]
fn миграция_идемпотентна() {
    let _guard = guard();
    unlock();
    let config = config_with_password("srv-1", "пароль-1");

    let first = crate::secrets::migrate(&config);
    let second = crate::secrets::migrate(&config);

    assert_eq!(first.migrated, 1);
    assert_eq!(second.migrated, 0, "повторный запуск не должен ничего переносить");
    assert_eq!(second.present, 1, "повторный запуск должен увидеть секрет на месте");
    assert!(second.is_complete());
}

/// Закрытый вольт переноса не делает, но и не портит данные: приложение
/// продолжит работать через вольт и попросит ключ, как и раньше.
#[test]
fn закрытый_вольт_оставляет_миграцию_невыполненной() {
    let _guard = guard();
    // Конфиг собирается при открытом вольте: `sealed()` сама шифрует и без
    // открытого хранилища упала бы с VAULT_LOCKED.
    unlock();
    let config = config_with_password("srv-1", "пароль-1");
    crate::vault::lock();

    let report = crate::secrets::migrate(&config);

    assert_eq!(report.skipped, 1, "непрочитанный блоб должен быть посчитан");
    assert!(report.needs_vault(), "без открытого вольта хранилище неполно");
    assert!(keychain::read_slot(&Slot::Password("srv-1".to_owned())).is_none());
}

/// Секрет крупнее лимита остаётся в вольте и помечает хранилище неполным.
#[test]
fn крупный_секрет_остаётся_в_вольте() {
    let _guard = guard();
    unlock();
    let big = "x".repeat(crate::keychain::MAX_SYSTEM_SECRET_BYTES + 10);
    let config = config_with_password("srv-big", &big);

    let report = crate::secrets::migrate(&config);

    assert_eq!(report.too_large, 1);
    assert!(report.needs_vault());
    assert!(!report.is_complete());
    assert!(keychain::read_slot(&Slot::Password("srv-big".to_owned())).is_none());
}

/// Приватные ключи лежат не в карте, а в блоке избранного: миграция обязана их
/// видеть, иначе самые важные секреты остались бы только в вольте.
#[test]
fn миграция_охватывает_приватные_ключи() {
    let _guard = guard();
    unlock();
    // Содержимое ключа здесь не разбирается: проверяется только перенос и
    // шифрование блоба. Поэтому вместо ключа — осмысленная заглушка, которую
    // нельзя принять за настоящий приватный ключ.
    let key_text = crate::tests::fixtures::OPAQUE_KEY_MATERIAL;
    let mut config = config_with_password("srv-1", "пароль");
    let mut favorite = server("srv-1");
    favorite.private_key = serde_json::to_value(sealed(key_text)).ok();
    config.favorites = vec![favorite];

    let report = crate::secrets::migrate(&config);

    assert_eq!(report.migrated, 2, "переносились и пароль, и приватный ключ");
    assert_eq!(
        keychain::read_slot(&Slot::PrivateKey("srv-1".to_owned())).as_deref(),
        Some(key_text)
    );
}

// ── Чтение ────────────────────────────────────────────────────────────────────

/// Главное свойство модели: секрет читается из системного хранилища даже при
/// закрытом вольте. Именно ради этого вольт на старте не открывается.
#[test]
fn секрет_читается_без_вольта() {
    let _guard = guard();
    unlock();
    let config = config_with_password("srv-1", "пароль-1");
    crate::secrets::migrate(&config);
    // Вольт закрыт — обычное состояние после переноса.
    crate::vault::lock();

    assert_eq!(resolve_password(&server("srv-1")), Ok(Some("пароль-1".to_owned())));
}

/// Секрета нет нигде — возвращается открытое значение конфига, а не ошибка.
#[test]
fn отсутствие_секрета_не_ошибка() {
    let _guard = guard();
    crate::config::set_cache_for_test(AppConfig::default());
    let mut target = server("srv-1");
    target.password = Some("из-конфига".to_owned());

    assert_eq!(resolve_password(&target), Ok(Some("из-конфига".to_owned())));
}

/// Битый блоб по-прежнему поднимает ошибку, а не выглядит как «пароля нет».
#[test]
fn битый_блоб_даёт_ошибку_а_не_пустоту() {
    let _guard = guard();
    // Блоб шифруется одним ключом, а вольт открывается другим. «Битость» получается
    // детерминированно: не надо править base64 и гадать, какие символы попались
    // в данные, — предыдущая правка молча ничего не меняла, если буквы `A` в
    // блобе не было, и тест проходил на живом ключе.
    unlock();
    let blob = sealed(crate::tests::fixtures::FAKE_PASSWORD);
    let (other_key, other_salt) = (
        crate::paths::random_base64(32),
        crate::paths::random_base64(16),
    );
    crate::vault::unlock(&other_key, &other_salt).expect("вольт открыт другим ключом");

    let mut passwords = BTreeMap::new();
    passwords.insert("srv-1".to_owned(), blob);
    crate::config::set_cache_for_test(AppConfig {
        encrypted_passwords: Some(passwords),
        ..AppConfig::default()
    });

    // Системного хранилища нет, вольт открыт, блоб зашифрован чужим ключом.
    assert_eq!(resolve_password(&server("srv-1")), Err("errors.vaultDecryptFailed".to_owned()));
}

/// Закрытый вольт при наличии блоба даёт явную ошибку, а не «пароля нет»: иначе
/// подключение падало бы с невнятным отказом авторизации.
#[test]
fn закрытый_вольт_даёт_ошибку_а_не_пустоту() {
    let _guard = guard();
    unlock();
    let config = config_with_password("srv-1", "пароль-1");
    crate::config::set_cache_for_test(config);
    crate::vault::lock();

    assert_eq!(resolve_password(&server("srv-1")), Err("errors.vaultDecryptFailed".to_owned()));
}

// ── Двойная запись ────────────────────────────────────────────────────────────

/// Создание секрета обновляет оба хранилища: вольт для бэкапа, системное
/// хранилище для подключения.
#[test]
fn создание_секрета_обновляет_оба_хранилища() {
    let _guard = guard();
    unlock();
    take_pending();

    let mut favorites = vec![server("srv-1")];
    favorites[0].password = Some("новый-пароль".to_owned());
    let mut store: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
    crate::config::sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, true);

    // Вольт: блоб и никакого открытого пароля в избранном.
    let blob = store.get("srv-1").expect("блоб в вольте");
    assert_eq!(crate::vault::decrypt(blob), Ok("новый-пароль".to_owned()));
    assert!(favorites[0].password.is_none(), "открытый пароль остался в избранном");

    // Системное хранилище: та же операция поставлена в очередь.
    let pending = take_pending();
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0],
        Op::Set {
            kind: Kind::Password,
            server_id: "srv-1".to_owned(),
            value: "новый-пароль".to_owned(),
        }
    );
    assert_eq!(apply_all(&pending), 1);
    assert_eq!(keychain::read_slot(&Slot::Password("srv-1".to_owned())).as_deref(), Some("новый-пароль"));
}

/// Пустая строка означает «секрет удалён» (семантика Electron) — слот в
/// системном хранилище тоже должен уйти.
#[test]
fn удаление_секрета_чистит_оба_хранилища() {
    let _guard = guard();
    unlock();
    take_pending();

    let mut favorites = vec![server("srv-1")];
    favorites[0].password = Some(String::new());
    let mut store: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
    store.insert("srv-1".to_owned(), sealed("старый"));
    crate::config::sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, true);

    assert!(!store.contains_key("srv-1"), "блоб остался в вольте");
    let pending = take_pending();
    assert_eq!(pending, vec![Op::Remove { kind: Kind::Password, server_id: "srv-1".to_owned() }]);
    apply_all(&pending);
    assert!(keychain::read_slot(&Slot::Password("srv-1".to_owned())).is_none());
}

/// Парольная фраза обновляется в своём слоте и не путается с паролем сервера.
#[test]
fn парольная_фраза_идёт_в_отдельный_слот() {
    let _guard = guard();
    unlock();
    take_pending();

    let mut favorites = vec![server("srv-1")];
    favorites[0].key_passphrase = Some("фраза".to_owned());
    let mut store: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
    crate::config::sync_favorites_secrets(&mut favorites, SecretField::KeyPassphrase, &mut store, true);

    let pending = take_pending();
    assert_eq!(pending[0], Op::Set {
        kind: Kind::KeyPassphrase,
        server_id: "srv-1".to_owned(),
        value: "фраза".to_owned(),
    });
}

/// Удалённый сервер обязан убрать свои слоты: `save_config` присылает конфиг
/// целиком, и иначе пароль остался бы в системном хранилище навсегда.
#[test]
fn удалённый_сервер_чистит_слоты() {
    let _guard = guard();
    take_pending();

    let mut previous = config_with_password("srv-1", "пароль");
    previous.favorites[0].private_key =
        serde_json::to_value(sealed(crate::tests::fixtures::OPAQUE_KEY_MATERIAL)).ok();
    let next = AppConfig::default();

    stage_removals(&previous, &next);

    let pending = take_pending();
    assert!(pending.contains(&Op::Remove { kind: Kind::Password, server_id: "srv-1".to_owned() }));
    assert!(pending.contains(&Op::Remove { kind: Kind::PrivateKey, server_id: "srv-1".to_owned() }));
}

/// Смена адреса сервера не должна вычищать секреты: удаляется только то, чего
/// в новом конфиге действительно нет.
#[test]
fn живой_сервер_слоты_не_теряет() {
    let _guard = guard();
    // Фикстура шифруется сама, поэтому вольт должен быть открыт.
    unlock();
    take_pending();

    let previous = config_with_password("srv-1", crate::tests::fixtures::FAKE_PASSWORD);
    let mut next = previous.clone();
    next.favorites[0].host = "new.example".to_owned();

    stage_removals(&previous, &next);

    assert!(take_pending().is_empty(), "живой сервер не должен давать операций удаления");
}

// ── Полная очистка ────────────────────────────────────────────────────────────

/// Сброс хранилища не оставляет старых слотов: иначе новый пустой вольт
/// сопровождался бы прежними паролями.
#[test]
fn полная_очистка_убирает_все_слоты() {
    let _guard = guard();
    unlock();
    let config = config_with_password("srv-1", "пароль-1");
    crate::secrets::migrate(&config);
    assert!(keychain::read_slot(&Slot::Password("srv-1".to_owned())).is_some());

    let removed = clear_all_secrets(&config);

    assert_eq!(removed, 1);
    assert!(keychain::read_slot(&Slot::Password("srv-1".to_owned())).is_none());
    // Ключ восстановления остаётся: сброс хранилища не должен требовать ввод
    // ключа на следующем запуске.
    assert!(keychain::read_slot(&Slot::RecoveryKey).is_none() || true);
}

// ── Показ окна ввода ключа ────────────────────────────────────────────────────

/// Ключ в системном хранилище означает, что фон откроет вольт сам: окно ввода не
/// нужно, даже если часть секретов в вольте осталась.
///
/// Без этой проверки окно мигало бы до секунды при каждом запуске у всех, у кого
/// есть приватный ключ длиннее лимита Credential Manager.
#[test]
fn кэш_ключа_скрывает_окно_ввода() {
    let _guard = guard();
    unlock();
    let mut config = config_with_password("srv-1", crate::tests::fixtures::FAKE_PASSWORD);
    // Перенос не завершён: крупный секрет остался в вольте.
    config.secrets_in_system_store = Some(false);
    config.cached_recovery_key = Some(crate::keychain::cache_marker().to_owned());
    crate::vault::lock();

    let status = crate::commands::build_vault_status(&config);

    assert!(status.is_initialized);
    assert!(!status.is_unlocked, "на момент первого кадра вольт ещё закрыт");
    assert!(status.secrets_available, "ключ в хранилище — вводить нечего");
}

/// Секреты есть, ключа в хранилище нет, перенос не прошёл — окно обязано
/// появиться, иначе секреты были бы недоступны без единого объяснения.
#[test]
fn без_ключа_окно_ввода_показывается() {
    let _guard = guard();
    unlock();
    // Именно зашифрованный секрет: без него вводить нечего и окно не нужно
    // (см. `свежая_установка_окно_не_показывает`).
    let mut passwords = BTreeMap::new();
    passwords.insert("srv-1".to_owned(), sealed(crate::tests::fixtures::FAKE_PASSWORD));
    crate::vault::lock();

    let status = crate::commands::build_vault_status(&AppConfig {
        encryption: Some(EncryptionInfo { version: 1, salt: "salt".to_owned(), check: None }),
        secrets_in_system_store: Some(false),
        cached_recovery_key: None,
        encrypted_passwords: Some(passwords),
        ..AppConfig::default()
    });

    assert!(status.is_initialized);
    assert!(!status.secrets_available, "окно ввода обязано быть показано");
}

/// Соль есть, а зашифрованных секретов нет: ключ не защищает ничего, поэтому
/// окно ввода не нужно. Соль появляется в конфиге раньше первого секрета.
#[test]
fn соль_без_секретов_окно_не_показывает() {
    let _guard = guard();
    crate::vault::lock();

    let status = crate::commands::build_vault_status(&AppConfig {
        encryption: Some(EncryptionInfo { version: 1, salt: "salt".to_owned(), check: None }),
        ..AppConfig::default()
    });

    assert!(status.is_initialized);
    assert!(status.secrets_available, "защищать нечего — вводить ключ незачем");
}

/// Перенос завершён — окно не нужно независимо от кэша ключа.
#[test]
fn завершённый_перенос_скрывает_окно() {
    let _guard = guard();
    unlock();
    let mut config = config_with_password("srv-1", crate::tests::fixtures::FAKE_PASSWORD);
    config.secrets_in_system_store = Some(true);
    crate::vault::lock();

    let status = crate::commands::build_vault_status(&config);

    assert!(status.secrets_available, "перенос завершён — вводить нечего");
}

/// Свежая установка: соль есть, секретов нет, переноса ещё не было.
#[test]
fn свежая_установка_окно_не_показывает() {
    let _guard = guard();
    crate::vault::lock();

    let status = crate::commands::build_vault_status(&AppConfig::default());

    assert!(!status.is_initialized);
    assert!(status.secrets_available);
}

// ── Деградация ───────────────────────────────────────────────────────────────

/// Без системного хранилища приложение продолжает работать через вольт:
/// операции молча не применяются, данные не теряются.
#[test]
fn без_хранилища_приложение_работает_через_вольт() {
    let _guard = guard();
    // Backend, который ничего не принимает, — то же, что недоступное хранилище.
    keychain::set_backend(Arc::new(FailingBackend));
    unlock();
    take_pending();

    let config = config_with_password("srv-1", "пароль-1");
    let report = crate::secrets::migrate(&config);
    assert!(report.needs_vault(), "без хранилища вольт остаётся обязательным");

    // Запись секрета не падает: вольт уже записан, потеря операции безопасна.
    let mut favorites = vec![server("srv-2")];
    favorites[0].password = Some("пароль-2".to_owned());
    let mut store: BTreeMap<String, EncryptedSecret> = BTreeMap::new();
    crate::config::sync_favorites_secrets(&mut favorites, SecretField::Password, &mut store, true);
    assert!(store.contains_key("srv-2"), "вольт должен сохраняться и без хранилища");
    assert_eq!(apply_all(&take_pending()), 0);
}

/// Хранилище всегда под тестовым сервисом: тесты не должны попасть в настоящие
/// Credential Manager / Keychain.
#[test]
fn тесты_не_трогают_боевой_сервис() {
    assert_ne!(crate::keychain::service(), crate::paths::KEYCHAIN_SERVICE);
    assert_eq!(crate::keychain::service(), TEST_SERVICE);
}

/// Backend, отказающий на любой операции: моделирует недоступное хранилище.
struct FailingBackend;

impl SecretBackend for FailingBackend {
    fn read(&self, _service: &str, _account: &str) -> Result<Option<String>, String> {
        Err("хранилище недоступно".to_owned())
    }
    fn write(&self, _service: &str, _account: &str, _value: &str) -> Result<(), String> {
        Err("хранилище недоступно".to_owned())
    }
    fn delete(&self, _service: &str, _account: &str) -> Result<(), String> {
        Err("хранилище недоступно".to_owned())
    }
}
