use super::*;
use std::io::Write as _;

/// Направление передачи едет в UI и в ключ прогресса как есть.
#[test]
fn направление_передачи_строкой() {
    assert_eq!(Direction::Upload.as_str(), "upload");
    assert_eq!(Direction::Download.as_str(), "download");
}

/// Отмена и «сервер закрыл канал» — не ошибки: пользователь должен увидеть
/// статус отмены, а не сообщение об ошибке передачи.
#[test]
fn отмена_и_разрыв_канала_не_ошибка() {
    // Любая ошибка при отменённой передаче трактуется как отмена.
    assert!(is_cancellation_like("что угодно", false));

    assert!(is_cancellation_like("Transfer cancelled", true));
    assert!(is_cancellation_like("No response from server", true));
    assert!(is_cancellation_like("Channel closed", true));
    assert!(is_cancellation_like("socket destroyed", true));

    // Остальные ошибки — настоящие ошибки и должны показываться пользователю.
    assert!(!is_cancellation_like("Permission denied", true));
    assert!(!is_cancellation_like("No such file or directory", true));
    assert!(!is_cancellation_like("Disk full", true));
}

/// Отпечаток файла меняется при изменении размера или времени правки — по нему
/// «открыть в редакторе» понимает, что файл на сервере обновили.
#[test]
fn отпечаток_файла_меняется_при_правке() {
    let dir = std::env::temp_dir().join(format!("yassh-fingerprint-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("каталог");
    let path = dir.join("file.txt");

    // До создания файла отпечатка нет.
    assert!(file_fingerprint(&path).is_none(), "несуществующий файл не имеет отпечатка");

    let write = |path: &Path, text: &str| {
        let mut file = std::fs::File::create(path).expect("создать файл");
        file.write_all(text.as_bytes()).expect("записать");
        file.sync_all().expect("сбросить на диск");
    };

    write(&path, "один");
    let first = file_fingerprint(&path).expect("отпечаток созданного файла");
    assert!(first.0 > 0, "размер должен совпадать с числом байт");

    // Время изменения на некоторых файловых системах имеет секундную
    // точность, поэтому опираемся на размер: он меняется гарантированно.
    write(&path, "один два три");
    let second = file_fingerprint(&path).expect("отпечаток после правки");
    assert!(second.0 > first.0, "размер изменился, а отпечаток остался прежним");

    // Каталог вместо файла: размер есть, но это не ошибка — отпечаток вернётся.
    let subdir = dir.join("sub");
    std::fs::create_dir_all(&subdir).expect("подкаталог");
    assert!(file_fingerprint(&subdir).is_some());

    let _ = std::fs::remove_dir_all(&dir);
}

/// Период опроса файла не должен быть нулевым: иначе наблюдение за файлом
/// съедало бы процессор.
#[test]
fn период_опроса_файла_разумный() {
    assert!(WATCH_INTERVAL >= Duration::from_millis(100), "слишком частый опрос: {WATCH_INTERVAL:?}");
    assert!(WATCH_INTERVAL <= Duration::from_secs(2), "слишком редкий опрос: {WATCH_INTERVAL:?}");
}

/// Результат передачи сериализуется в camelCase: фронтенд читает эти поля по
/// именам, а пустые необязательные поля не отправляются вовсе.
#[test]
fn результат_передачи_сериализуется_для_фронтенда() {
    let outcome = TransferOutcome {
        remote_path: "/srv/file.txt".to_owned(),
        local_path: Some("/tmp/file.txt".to_owned()),
        is_dir: Some(false),
        items: None,
        cancelled: None,
        size: Some(1024),
    };
    let json = serde_json::to_value(&outcome).expect("json");
    assert_eq!(json["remotePath"], "/srv/file.txt");
    assert_eq!(json["localPath"], "/tmp/file.txt");
    assert_eq!(json["isDir"], false);
    assert_eq!(json["size"], 1024);
    // Незаполненные поля не должны занимать место в IPC-сообщении.
    assert!(json.get("items").is_none(), "пустой items попал в сообщение: {json}");
    assert!(json.get("cancelled").is_none(), "пустой cancelled попал в сообщение: {json}");
}

/// Отмена помечается отдельным полем, а не ошибкой: по нему UI показывает
/// понятный статус и убирает передачу из списка.
#[test]
fn отмена_передачи_помечается_флагом() {
    let outcome = TransferOutcome {
        remote_path: "/srv/file.txt".to_owned(),
        local_path: None,
        is_dir: None,
        items: None,
        cancelled: Some(true),
        size: None,
    };
    let json = serde_json::to_value(&outcome).expect("json");
    assert_eq!(json["cancelled"], true);
    assert!(json.get("localPath").is_none());
    assert!(json.get("size").is_none());
}