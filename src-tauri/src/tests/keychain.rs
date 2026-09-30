use super::*;

#[test]
fn маркер_не_содержит_ключа() {
    // В конфиг кладётся константа, а не производная от секрета: сам ключ
    // лежит в системном хранилище и в конфиг не попадает.
    assert_eq!(cache_marker(), "keychain");
    assert!(
        cache_marker().bytes().all(|byte| byte.is_ascii_lowercase()),
        "маркер не должен содержать данные ключа: {}",
        cache_marker()
    );
}

#[test]
fn операции_не_паникуют() {
    // Конкретное поведение зависит от наличия системного хранилища,
    // важно лишь отсутствие паники и корректный тип ответа.
    let _ = has_recovery_key();
    let _ = store_recovery_key("test");
    let _ = delete_recovery_key();
}
