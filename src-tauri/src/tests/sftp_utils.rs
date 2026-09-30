use super::*;

#[test]
fn нормализует_пути() {
    assert_eq!(normalize_remote_path("//a//b/"), "/a/b");
    assert_eq!(normalize_remote_path("/"), "/");
    assert_eq!(normalize_remote_path("/a/"), "/a");
    assert_eq!(normalize_remote_path("a/b"), "a/b");
}

#[test]
fn строит_временный_путь() {
    assert_eq!(temp_remote_path("/srv/data/file.txt", "t1"), "/srv/data/.file.txt.uploading-t1");
    assert_eq!(temp_remote_path("/file.txt", "t2"), "/.file.txt.uploading-t2");
    assert_eq!(temp_remote_path("/", "t3"), "/.uploading-t3");
}

#[test]
fn экранирует_кавычки() {
    assert_eq!(escape_remote_path("/tmp/a'b"), "'/tmp/a'\\''b'");
}

#[test]
fn извлекает_расширение() {
    assert_eq!(normalized_extension("Main.RS"), ".rs");
    assert_eq!(normalized_extension("noext"), "");
}

/// Нормализация используется перед каждой операцией с путём, поэтому
/// она обязана быть идемпотентной и не терять содержимое.
#[test]
fn нормализация_идемпотентна() {
    for path in ["//a//b/", "/", "/a/", "a/b", "", "///", "/путь/файл.txt/"] {
        let once = normalize_remote_path(path);
        assert_eq!(normalize_remote_path(&once), once, "путь {path:?} не устоялся");
    }
    assert_eq!(normalize_remote_path(""), "/");
    assert_eq!(normalize_remote_path("///"), "/");
    // Кириллица и пробелы в именах не трогаются.
    assert_eq!(normalize_remote_path("/мой путь/файл.txt"), "/мой путь/файл.txt");
}

/// Временный путь обязан быть уникальным на каждый transferId, иначе
/// параллельные загрузки одного файла конфликтуют.
#[test]
fn временный_путь_уникален_для_каждой_передачи() {
    let first = temp_remote_path("/srv/data/file.txt", "t1");
    let second = temp_remote_path("/srv/data/file.txt", "t2");
    assert_ne!(first, second);
    assert_eq!(first, temp_remote_path("//srv//data//file.txt", "t1"), "нормализация влияет на имя");
    // Скрытый файл лежит рядом с оригиналом, а не в корне.
    assert!(first.starts_with("/srv/data/."));
    assert!(first.ends_with(".uploading-t1"));
}

/// «Нет такого файла» приходит в разных форматах — все должны считаться
/// одним и тем же состоянием, иначе удаление падает на первом же файле.
#[test]
fn распознаёт_отсутствие_файла() {
    for text in ["No such file or directory", "ENOENT: no such file", "Status error: 2", "code: 2"] {
        assert!(is_no_such_file(text), "не распознано: {text}");
    }
    for text in ["Permission denied", "Status error: 3", "connection reset", ""] {
        assert!(!is_no_such_file(text), "лишняя ошибка принята за ENOENT: {text}");
    }
}

/// Тип файла определяется по битам `st_mode`, а не по младшим девяти.
#[test]
fn тип_файла_определяется_по_битам() {
    let of = |mode| russh_sftp::client::fs::Metadata { permissions: Some(mode), ..Default::default() };
    let without = russh_sftp::client::fs::Metadata::default();

    assert!(is_dir(&of(0o040_755)));
    assert!(!is_dir(&of(0o100_644)));
    assert!(!is_dir(&of(0o755)), "права без битов типа не делают файл каталогом");
    assert!(!is_dir(&without), "без прав тип неизвестен");

    assert!(is_symlink(&of(0o120_777)));
    assert!(!is_symlink(&of(0o100_644)));
    assert!(!is_symlink(&without));
    // Симлинк не считается каталогом даже если права выглядят как `drwx`.
    assert!(!is_dir(&of(0o120_777)));
}

/// Экранирование обязано закрывать путь от инъекции в удалённую команду.
#[test]
fn экранирование_закрывает_инъекцию() {
    // Классическая инъекция через закрытие кавычки и `;`.
    let escaped = escape_remote_path("/tmp/a'; rm -rf /; echo '");
    assert!(escaped.starts_with('\'') && escaped.ends_with('\''));
    // Внутри одинарных кавычек одинарная кавычка экранируется парой.
    assert_eq!(escaped.matches('\'').count() % 2, 0, "нечётное число кавычек: {escaped}");
    assert!(escaped.contains("'\\''"), "кавычка должна быть экранирована");
    assert_eq!(escape_remote_path("/tmp/plain"), "'/tmp/plain'");
}

/// Расширение нужно для выбора распаковщика; файлы без расширения и
/// «скрытые» файлы (`.bashrc`) не должны давать мусорного расширения.
#[test]
fn расширение_для_скрытых_файлов_пустое() {
    assert_eq!(normalized_extension(".bashrc"), "");
    assert_eq!(normalized_extension("archive.TAR.GZ"), ".gz");
    assert_eq!(normalized_extension("путь/к/файлу.Zip"), ".zip");
}
