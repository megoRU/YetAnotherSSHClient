use super::*;

/// Системное хранилище общее на весь процесс, а тесты идут параллельно: без
/// блокировки соседний тест удаляет или перезаписывает общий ключ.
fn guard() -> parking_lot::MutexGuard<'static, ()> {
    static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
    LOCK.lock()
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

/// Обёртка кэша пишет ключ и только затем логирует успех: без хранилища
/// вызывающий код должен получить `false`, а не «записали, но не туда».
#[test]
fn обёртка_кэша_сообщает_об_успехе() {
    let _guard = guard();
    let stored = cache_recovery_key("обёртка-тест");
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