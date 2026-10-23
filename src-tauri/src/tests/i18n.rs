use super::*;

#[test]
fn creates_a_localization_marker_with_key_and_params() {
    let marker = t("errors.socketError", &[("message", "connection reset")]);
    assert!(marker.starts_with('\u{1e}'));
    assert!(marker.ends_with('\u{1f}'));
    assert!(marker.contains(r#""key":"errors.socketError""#));
    assert!(marker.contains(r#""message":"connection reset""#));
}
