use super::*;

#[test]
fn строит_команды_для_поддерживаемых_форматов() {
    assert_eq!(
        extract_command("/srv/a.zip").as_deref(),
        Some("unzip -o '/srv/a.zip' -d '/srv'")
    );
    // tar распаковывается в каталог через `-C` (GNU и BSD tar), а не `-d`:
    // `-d` понимает только unzip.
    assert_eq!(
        extract_command("/srv/a.tar.gz").as_deref(),
        Some("tar -xzf '/srv/a.tar.gz' -C '/srv'")
    );
    assert_eq!(
        extract_command("/srv/a.tar.bz2").as_deref(),
        Some("tar -xjf '/srv/a.tar.bz2' -C '/srv'")
    );
}

#[test]
fn отклоняет_неподдерживаемые_форматы() {
    assert!(extract_command("/srv/a.rar").is_none());
    assert!(extract_command("/srv/a").is_none());
}

#[test]
fn экранирует_пробелы_и_кавычки() {
    let command = extract_command("/srv/my dir/a's.zip").expect("supported");
    assert!(command.contains("'/srv/my dir/a'\\''s.zip'"));
}
