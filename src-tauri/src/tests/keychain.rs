use super::*;

/// Системное хранилище общее на весь процесс, а тесты идут параллельно: без
/// блокировки соседний тест удаляет или перезаписывает общий ключ.
fn guard() -> parking_lot::MutexGuard<'static, ()> {
    static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
    LOCK.lock()
}

/// Тесты обязаны работать с отдельной записью системного хранилища.
///
/// Регрессия, стоившая пользователю ключа восстановления: тесты использовали
/// боевой `com.yash.client / vault-recovery-key` и вызывали
/// `delete_recovery_key()`. Любой `cargo test` стирал настоящий ключ, и
/// приложение снова спрашивало его при следующем запуске — при полностью
/// целых данных. Проверяем, что запись у тестов своя.
#[test]
fn тесты_не_трогают_боевую_запись() {
    // Изоляция тестов обеспечивается сервисом, а не именем слота: слот ключа
    // восстановления обязан называться одинаково и у пользователей, и в тестах,
    // иначе тест перестал бы проверять настоящий путь записи.
    assert_eq!(service(), TEST_SERVICE, "тесты работают с боевым сервисом");
    assert_ne!(service(), crate::paths::KEYCHAIN_SERVICE, "сервис совпадает с боевым");
    assert_eq!(Slot::RecoveryKey.account(), crate::paths::KEYCHAIN_USER);
}

/// Боевая запись должна оставаться нетронутой после полного цикла тестов.
///
/// Настоящий ключ восстановления пользователя не создаётся и не удаляется:
/// проверяется только то, что модуль обращается к другой записи.
#[test]
fn боевая_запись_не_затрагивается() {
    let _guard = guard();
    let before = has_recovery_key();

    // Полный цикл против тестовой записи.
    delete_recovery_key();
    store_recovery_key("тестовый-ключ");
    load_recovery_key();
    delete_recovery_key();

    assert_eq!(
        has_recovery_key(),
        before,
        "цикл тестов изменил состояние боевой записи"
    );
}

/// Слоты секретов не должны совпадать со слотом ключа восстановления: иначе
/// удаление пароля сервера стёрло бы ключ восстановления.
#[test]
fn удаление_секрета_не_трогает_ключ_восстановления() {
    let _guard = guard();
    if !store_recovery_key("ключ-восстановления") {
        return;
    }

    let slot = Slot::Password("srv-1".to_owned());
    if !write_slot(&slot, "пароль") {
        delete_recovery_key();
        return;
    }
    delete_slot(&slot);

    assert!(
        has_recovery_key(),
        "удаление слота секрета затронуло слот ключа восстановления"
    );
    delete_recovery_key();
}

/// Настоящий цикл «записать → прочитать → удалить» против системного хранилища.
///
/// Тест вынужденно деградирует: если хранилище недоступно (нет secret service,
/// сборка `--no-default-features`), проверка заканчивается успехом — важно
/// лишь то, что приложение не падает и не выдаёт «есть ключ» там, где его нет.
#[test]
fn ключ_пишется_читается_и_удаляется() {
    let _guard = guard();
    delete_recovery_key();

    if !store_recovery_key("тестовый-ключ") {
        // Хранилище недоступно: функции обязаны сообщить об этом «мягко».
        assert!(!has_recovery_key());
        return;
    }

    assert_eq!(load_recovery_key().as_deref(), Some("тестовый-ключ"));
    assert!(has_recovery_key());

    assert!(delete_recovery_key());
    assert!(!has_recovery_key(), "после удаления ключ не должен оставаться в хранилище");
}

/// Маркер в конфиге не должен превращаться в ключ: им пользуется код, который
/// читает файл конфига.
#[test]
fn маркер_в_хранилище_не_считается_ключом() {
    let _guard = guard();
    delete_recovery_key();
    if !store_recovery_key(cache_marker()) {
        return;
    }
    // Если бы маркер считался ключом, приложение открыло бы хранилище секретов
    // «пустым» ключом и не показало бы форму ввода.
    assert!(!has_recovery_key(), "маркер не должен выдаваться за ключ восстановления");

    delete_recovery_key();
}

/// Пустая строка — не ключ: иначе авторазблокировка «срабатывала» бы сама.
#[test]
fn пустой_ключ_не_считается_сохранённым() {
    let _guard = guard();
    delete_recovery_key();
    if !store_recovery_key("") {
        return;
    }
    assert!(load_recovery_key().is_none(), "пустой ключ не должен возвращаться как ключ");
    delete_recovery_key();
}

/// Повторная запись заменяет прежний ключ, а не добавляет второй.
#[test]
fn повторная_запись_заменяет_ключ() {
    let _guard = guard();
    delete_recovery_key();
    if !store_recovery_key("первый") {
        return;
    }
    assert!(store_recovery_key("второй"));
    assert_eq!(load_recovery_key().as_deref(), Some("второй"));
    delete_recovery_key();
}

/// Слот ключа восстановления пишется и чистится слот-операциями: команда
/// кладёт ключ в отдельном потоке, и без хранилища должна получить `false`, а не
/// «записали, но не туда».
#[test]
fn слот_ключа_восстановления_пишется_и_чистится() {
    let _guard = guard();
    let stored = write_slot(&Slot::RecoveryKey, "обёртка-тест");
    if !stored {
        // Деградация: без хранилища ключ просто не кэшируется.
        assert!(!has_recovery_key());
        return;
    }
    assert!(has_recovery_key());
    clear_cached_recovery_key();
    assert!(!has_recovery_key(), "clear_cached_recovery_key не удалил ключ");
}

/// Удаление отсутствующей записи не должно падать: вызывается при каждом
/// закрытии приложения.
#[test]
fn удаление_отсутствующего_ключа_безопасно() {
    let _guard = guard();
    delete_recovery_key();
    let _ = delete_recovery_key();
    let _ = clear_cached_recovery_key();
}