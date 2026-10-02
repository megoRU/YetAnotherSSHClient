use super::*;

/// Каталог определяется битами типа файла, а не младшими девятью.
#[test]
fn каталог_определяется_по_битам_типа() {
    assert!(is_dir_mode(0o040_755));
    assert!(is_dir_mode(0o040_000));
    assert!(!is_dir_mode(0o100_644));
    assert!(!is_dir_mode(0o120_777));
    // Права без битов типа (как приходит от некоторых SFTP-серверов)
    // каталогом не считаются.
    assert!(!is_dir_mode(0o755));
}

#[test]
fn атрибуты_сериализуются_как_ожидает_фронтенд() {
    let attrs = FileAttrs {
        mode: 0o040_755,
        uid: 1000,
        gid: 1000,
        size: 0,
        atime: 0,
        mtime: 1_700_000_000,
    };
    let json = serde_json::to_value(&attrs).expect("json");
    assert_eq!(json["mode"], 0o040_755);
    assert_eq!(json["mtime"], 1_700_000_000u64);
}

#[test]
fn цель_симлинка_опускается_когда_её_нет() {
    let entry = FileEntry {
        filename: "link".to_owned(),
        longname: "link".to_owned(),
        attrs: FileAttrs {
            mode: 0o120_777,
            uid: 0,
            gid: 0,
            size: 0,
            atime: 0,
            mtime: 0,
        },
        target_attrs: None,
    };
    let json = serde_json::to_value(&entry).expect("json");
    // Рендерер читает `targetAttrs` только когда поле есть.
    assert!(json.get("targetAttrs").is_none());
}

#[test]
fn глубина_пути_считается_по_слешам() {
    assert_eq!(depth_of("/"), 1);
    assert_eq!(depth_of("/a"), 1);
    assert_eq!(depth_of("/a/b"), 2);
    assert_eq!(depth_of("/a/b/c"), 3);
}

#[tokio::test]
async fn размер_файла_берётся_с_диска() {
    // Реальный файл (текущий исполняемый модуль): размер обязан совпасть с
    // тем, что отдаёт отдельная функция.
    let path = std::env::current_exe().expect("текущий exe");
    let path = path.to_string_lossy().to_string();
    let stat = stat_local(&path).await.expect("stat");
    assert!(!stat.is_dir);
    assert_eq!(stat.size, local_file_size(&path));
}

#[tokio::test]
async fn пустой_и_слишком_длинный_путь_отвергаются() {
    assert!(stat_local("").await.is_none());
    assert!(stat_local(&"x".repeat(5000)).await.is_none());
    assert!(stat_local("/no/such/path/xyz").await.is_none());
    assert_eq!(local_file_size("/no/such/path/xyz"), 0);
}
