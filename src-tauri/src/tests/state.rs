use super::*;

// ── Состояние окна ───────────────────────────────────────────────────────────

/// `WindowState` — то, чем обмениваются обработчик окна и команда
/// `renderer-content-ready`: пока флаг не выставлен, окно не показывается.
#[test]
fn окно_показывается_только_после_готовности_рендерера() {
    let state = WindowState::default();
    assert!(!state.renderer_content_ready, "до готовности рендерера показывать нечего");
    assert!(!state.page_loaded, "страница ещё не загружена");
    assert!(!state.startup_size_applied, "размер окна ещё не доведён до сохранённого");
    assert!(!state.shown, "окно не должно показываться дважды");
}

#[test]
fn состояние_окна_ждёт_всех_трёх_событий() {
    let mut state = WindowState::default();

    // Только страница загрузилась — рендерер ещё не отрисовал кадр.
    state.page_loaded = true;
    assert!(!state.renderer_content_ready);
    assert!(!state.shown);

    // Только рендерер готов — страница ещё грузится.
    let mut state = WindowState::default();
    state.renderer_content_ready = true;
    assert!(!state.page_loaded);
    assert!(!state.shown);

    // Рендерер готов и страница загружена, но размер окна ещё не доведён до
    // сохранённого: показать можно только после `prepare_startup_size`.
    let mut state = WindowState::default();
    state.page_loaded = true;
    state.renderer_content_ready = true;
    assert!(!state.startup_size_applied);
    assert!(!state.shown, "показ выполняет сама команда, а не конструктор");

    // Все события пришли — окно можно показывать.
    let state = WindowState {
        page_loaded: true,
        renderer_content_ready: true,
        startup_size_applied: true,
        ..Default::default()
    };
    assert!(!state.shown, "показ выполняет сама команда, а не конструктор");
}