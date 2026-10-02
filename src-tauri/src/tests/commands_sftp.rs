use super::*;

fn parse_mode(json: &str) -> Result<u32, serde_json::Error> {
    serde_json::from_value::<SftpChmodRequest>(serde_json::from_str(json)?).map(|request| request.mode)
}

/// `chmod` приходит с фронтенда и как число, и как строка — оба варианта
/// должны давать один и тот же режим.
#[test]
fn режим_chmod_читается_из_числа_и_строки() {
    assert_eq!(parse_mode(r#"{"id":"a","path":"/tmp","mode":493}"#).expect("число"), 493);
    assert_eq!(parse_mode(r#"{"id":"a","path":"/tmp","mode":"493"}"#).expect("строка"), 493);
    assert_eq!(parse_mode(r#"{"id":"a","path":"/tmp","mode":"0755"}"#).expect("octal"), 0o755);
    assert_eq!(parse_mode(r#"{"id":"a","path":"/tmp","mode":"0o755"}"#).expect("0o"), 0o755);
    assert_eq!(parse_mode(r#"{"id":"a","path":"/tmp","mode":"  755  "}"#).expect("пробелы"), 0o755);
}

#[test]
fn нечисловой_режим_chmod_отвергается() {
    // Мусор не должен превращаться в 0 (который означает «забрать все права»).
    assert!(parse_mode(r#"{"id":"a","path":"/tmp","mode":"rwxr-xr-x"}"#).is_err());
    assert!(parse_mode(r#"{"id":"a","path":"/tmp","mode":""}"#).is_err());
    assert!(parse_mode(r#"{"id":"a","path":"/tmp","mode":-1}"#).is_err());
}

#[test]
fn пути_и_идентификаторы_читаются_как_есть() {
    // Путь с пробелом и кириллицей не должен искажаться при разборе команды.
    let request: SftpRmRequest =
        serde_json::from_str(r#"{"id":"tab-1","path":"/tmp/папка a b","isDir":true}"#).expect("rm");
    assert_eq!(request.id, "tab-1");
    assert_eq!(request.path, "/tmp/папка a b");
    assert!(request.is_dir);
}

/// Имена полей команды приходят из TypeScript в camelCase.
#[test]
fn команды_принимают_camel_case_фронтенда() {
    let request: SftpRenameRequest =
        serde_json::from_str(r#"{"id":"tab-1","oldPath":"/a","newPath":"/b"}"#).expect("rename");
    assert_eq!(request.old_path, "/a");
    assert_eq!(request.new_path, "/b");

    let request: SftpChmodRequest =
        serde_json::from_str(r#"{"id":"tab-1","path":"/a","mode":420}"#).expect("chmod");
    assert_eq!(request.mode, 420);
}
