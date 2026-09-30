use super::*;

#[test]
fn агрегат_считает_проценты() {
    let state = AggregateState::new("/a", 200);
    assert_eq!(state.percent(), 0, "до начала передачи прогресс нулевой");
    assert_eq!(state.advance(50), (50, 200, 25));
    assert_eq!(state.advance(50), (100, 200, 50));
    assert_eq!(state.advance(0), (100, 200, 50), "отчёт без новых байт ничего не меняет");
    assert_eq!(state.transferred(), 100);
    assert_eq!(state.total(), 200);
    assert_eq!(state.percent(), 50);
    // Размер папки — снимок на момент старта, больше 100% не показываем.
    assert_eq!(state.advance(500), (200, 200, 100), "прогресс не может превышать 100");
    assert_eq!(state.percent(), 100);
}

#[test]
fn агрегат_считает_проценты_пустой_папки() {
    let state = AggregateState::new("/empty", 0);
    assert_eq!(state.percent(), 100, "пустая папка считается завершённой");
    assert_eq!(state.advance(0), (0, 0, 100));
}

#[test]
fn дельта_файла_считается_однократно() {
    let state = AggregateState::new("/a", 100);
    let mut reporter = ProgressReporter::new("s", "t", "upload");

    // Отчёты одного файла повторяют его накопленный размер: в агрегатор идут
    // только новые байты.
    assert_eq!(state.advance(reporter.count_delta(10)), (10, 100, 10));
    assert_eq!(state.advance(reporter.count_delta(40)), (40, 100, 40));
    assert_eq!(state.advance(reporter.count_delta(40)), (40, 100, 40), "повтор отчёта");
    assert_eq!(state.transferred(), 40);

    // Следующий файл папки начинается с нуля.
    let mut next = ProgressReporter::new("s", "t", "upload");
    let delta = next.count_delta(20);
    assert_eq!(delta, 20);
    assert_eq!(state.advance(delta), (60, 100, 60));
}

#[test]
fn отношение_файла_считает_проценты() {
    assert_eq!(ratio_progress(50, 200, 0), 25);
    assert_eq!(ratio_progress(0, 0, 100), 100);
}

/// Проценты агрегата никогда не выходят за 0..100, а трансфер без данных
/// считается завершённым — иначе пустая папка «вечно грузится».
#[test]
fn проценты_остаются_в_диапазоне() {
    for (transferred, total) in [(0u64, 0u64), (0, 100), (100, 100), (150, 100), (1, 3), (u64::MAX, u64::MAX)] {
        let percent = percent_of(transferred, total);
        assert!(percent <= 100, "процент вышел за 100: {percent} ({transferred}/{total})");
    }
    assert_eq!(percent_of(0, 0), 100, "пустой трансфер считается завершённым");
    assert_eq!(percent_of(1, 3), 33);
}

/// Параллельные отчёты файлов не должны терять байты: агрегатор обновляется
/// из нескольких задач загрузки одновременно.
#[tokio::test]
async fn параллельные_отчёты_не_теряют_байты() {
    const FILES: u64 = 3;
    const REPORTS: u64 = 10;
    const CHUNK: u64 = 10;

    let state = std::sync::Arc::new(AggregateState::new("/a", FILES * REPORTS * CHUNK));

    let mut tasks = Vec::new();
    for file in 0..FILES {
        let state = state.clone();
        tasks.push(tokio::spawn(async move {
            // У каждого файла свой репортёр: `counted` общий для всех отчётов
            // одного файла, поэтому дельты не должны пересекаться.
            let mut reporter = ProgressReporter::new("s", &format!("t-{file}"), "upload");
            let mut transferred = 0;
            for _ in 0..REPORTS {
                transferred += CHUNK;
                state.advance(reporter.count_delta(transferred));
                tokio::task::yield_now().await;
            }
        }));
    }
    for task in tasks {
        task.await.expect("задача отчётов");
    }

    assert_eq!(state.transferred(), FILES * REPORTS * CHUNK, "часть отчётов потерялась");
    assert_eq!(state.percent(), 100);
}

/// Повторный отчёт того же файла не удваивает прогресс — это и есть
/// причина, по которой `count_delta` возвращает дельту.
#[test]
fn повторный_отчёт_файла_не_удваивает_прогресс() {
    let state = AggregateState::new("/a", 1000);
    let mut reporter = ProgressReporter::new("s", "t", "download");

    // Отчёты одного файла повторяют накопленный размер: в агрегатор уходит
    // только новое приращение.
    state.advance(reporter.count_delta(200));
    assert_eq!(state.transferred(), 200);
    assert_eq!(reporter.count_delta(200), 0, "повторный отчёт дал дельту");
    state.advance(reporter.count_delta(400));
    assert_eq!(state.transferred(), 400, "приращение файла не учтено");

    // Отчёт с уменьшившимся размером (файл перезаписан) не откатывает
    // агрегатор назад: `saturating_sub` даёт 0.
    assert_eq!(reporter.count_delta(50), 0);
}
