use futures_util::stream::{self, StreamExt};
use iocraft::prelude::*;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use unicode_width::UnicodeWidthStr;

use super::app::App;
use super::grid::{fit, width, Grid, Move, MAX_COLUMN};
use super::model::{Effect, Key, Model, Object, Request, Response, Screen, MAX_ROWS, PAGE};
use super::picker::{matches, Entry, Picked};
use super::prompt::Prompt;

fn objects(count: usize) -> Vec<Object> {
    (0..count)
        .map(|index| Object {
            schema: format!("schema_{}", index % 40),
            name: format!("tabelle_{index}"),
            view: index % 7 == 0,
        })
        .collect()
}

fn rows(count: usize, columns: usize, from: usize) -> Vec<Vec<String>> {
    (from..from + count)
        .map(|row| {
            (0..columns)
                .map(|column| format!("wert-{row}-{column}-äöü"))
                .collect()
        })
        .collect()
}

fn names(columns: usize) -> Vec<String> {
    (0..columns)
        .map(|column| format!("spalte_{column}"))
        .collect()
}

fn opened(count: usize) -> Model {
    let mut model = Model::new(true);
    model.apply(Response::Opened {
        banner: Default::default(),
        objects: objects(count),
    });
    model
}

fn percentiles(mut samples: Vec<f64>) -> (f64, f64) {
    samples.sort_by(|a, b| a.total_cmp(b));
    let p95 = samples[(samples.len() * 95).div_ceil(100).saturating_sub(1)];
    (samples[samples.len() / 2], p95)
}

#[test]
fn fit_pads_and_cuts_by_display_width() {
    assert_eq!(fit("ab", 4), "ab  ");
    assert_eq!(fit("abcdef", 4), "abc…");
    assert_eq!(fit("界界界", 5).width(), 5);
    assert_eq!(fit("abc", 0), "");
    assert_eq!(width(&fit("☺\u{fe0f}☺\u{fe0f}x", 3)), 3);
}

#[test]
fn grid_lines_stay_inside_the_viewport() {
    let mut grid = Grid::new(names(30), rows(500, 30, 0));
    for width in [1, 2, 10, 79, 200] {
        assert!(grid.header(width).width() <= width);
        for line in grid.body(width, 40) {
            assert!(line.width() <= width, "{width}: {line}");
        }
    }
    assert_eq!(grid.body(80, 40).len(), 40);
    grid.scroll(Move::End, 40);
    assert_eq!(grid.body(80, 40).len(), 40);
    assert!(grid.position(40).contains("461–500 von 500"));
    grid.scroll(Move::Down, 40);
    assert!(grid.position(40).contains("461–500"));
    for _ in 0..100 {
        grid.scroll(Move::Right, 40);
    }
    assert!(grid.header(80).starts_with("spalte_29"));
    let wide = Grid::new(vec!["v".into()], vec![vec!["x".repeat(500)]]);
    assert_eq!(wide.body(200, 1)[0].trim_end().width(), MAX_COLUMN);
}

#[test]
fn control_characters_never_reach_the_terminal() {
    let object = Object {
        schema: "s".into(),
        name: "t\u{1b}[2J".into(),
        view: false,
    };
    assert!(!object.label().contains('\u{1b}'));
    let mut model = opened(1);
    model.apply(Response::Failed(
        "kaputt\u{1b}[0m\r\n  Hinweis\u{7}\n\n3\n4\n5".into(),
    ));
    assert_eq!(model.status, "kaputt [0m\nHinweis \n3\n4");
    let grid = Grid::new(vec!["a\u{7}".into()], Vec::new());
    assert!(!grid.header(10).contains('\u{7}'));
}

#[test]
fn picker_filters_by_all_terms() {
    let entry = |name: &str, kind: &str, environment: &str| Entry {
        name: name.into(),
        kind: kind.into(),
        environment: environment.into(),
        ..Entry::default()
    };
    let entries = [
        entry("Shop", "sqlite", ""),
        entry("Produktion", "postgres", "production"),
        entry("Archiv", "postgres", "staging"),
    ];
    assert_eq!(matches(&entries, ""), vec![0, 1, 2]);
    assert_eq!(matches(&entries, "sho"), vec![0]);
    assert_eq!(matches(&entries, "postgres stag"), vec![2]);
    assert!(matches(&entries, "fehlt").is_empty());
}

async fn prompted(events: Vec<TerminalEvent>) -> Option<usize> {
    let entries = ["Archiv", "Shop", "Zebra"]
        .map(|name| Entry {
            name: name.into(),
            ..Entry::default()
        })
        .to_vec();
    let outcome = Arc::new(Mutex::new(None));
    let mut prompt = element! {
        Prompt(entries, preselect: 0usize, outcome: Some(outcome.clone()))
    };
    let mut frames =
        prompt.mock_terminal_render_loop(MockTerminalConfig::with_events(stream::iter(events)));
    while frames.next().await.is_some() {}
    let picked = outcome.lock().unwrap().take();
    match picked {
        Some(Picked::Index(index)) => Some(index),
        _ => None,
    }
}

#[tokio::test]
async fn picker_follows_keys_that_arrive_in_one_batch() {
    let press = |code| TerminalEvent::Key(KeyEvent::new(KeyEventKind::Press, code));
    let typed = "zeb".chars().map(|c| press(KeyCode::Char(c)));
    let batch: Vec<_> = typed
        .chain([press(KeyCode::Enter), press(KeyCode::Esc)])
        .collect();
    assert_eq!(prompted(batch).await, Some(2));
    let arrows = vec![
        press(KeyCode::Down),
        press(KeyCode::Down),
        press(KeyCode::Enter),
    ];
    assert_eq!(prompted(arrows).await, Some(2));
    let pasted = vec![
        TerminalEvent::BracketedPaste("sho\nrest".into()),
        press(KeyCode::Enter),
    ];
    assert_eq!(prompted(pasted).await, Some(1));
    assert_eq!(prompted(vec![press(KeyCode::Esc)]).await, None);
}

#[test]
fn object_list_filters_opens_and_goes_back() {
    let mut model = opened(50);
    assert_eq!(model.screen, Screen::Objects);
    assert_eq!(model.key(Key::Char('/'), 20), None);
    for c in "tabelle_4".chars() {
        model.key(Key::Char(c), 20);
    }
    assert_eq!(model.visible().len(), 11);
    model.key(Key::Down, 20);
    let effect = model.key(Key::Enter, 20);
    let Some(Effect::Request(Request::Rows { object, offset: 0 })) = effect else {
        panic!("{effect:?}");
    };
    assert_eq!(object.name, "tabelle_40");
    model.apply(Response::Rows {
        object,
        columns: names(3),
        rows: rows(PAGE, 3, 0),
        offset: 0,
    });
    assert_eq!(model.screen, Screen::Table);
    assert_eq!(model.key(Key::Esc, 20), None);
    assert_eq!(model.screen, Screen::Objects);
    assert_eq!(model.key(Key::Esc, 20), None);
    assert!(model.filter.is_empty());
    assert_eq!(model.key(Key::Esc, 20), None);
    assert_eq!(model.screen, Screen::Connections);
    assert_eq!(model.key(Key::Char('q'), 20), None);
    assert_eq!(model.key(Key::Interrupt, 20), Some(Effect::Quit));
    let mut direct = Model::new(false);
    direct.apply(Response::Opened {
        banner: Default::default(),
        objects: objects(2),
    });
    assert_eq!(direct.key(Key::Esc, 20), Some(Effect::Quit));
    assert!(matches!(
        direct.key(Key::Char('d'), 20),
        Some(Effect::Request(Request::Columns(_)))
    ));
}

#[test]
fn production_writes_need_the_typed_name_and_escape_runs_nothing() {
    let mut model = opened(1);
    model.key(Key::Char('s'), 20);
    assert_eq!(model.key(Key::Run, 20), None);
    model.sql = "delete from kunde".into();
    assert_eq!(model.key(Key::Char('q'), 20), None);
    assert_eq!(
        model.key(Key::Run, 20),
        Some(Effect::Request(Request::Run {
            sql: "delete from kunde".into(),
            answer: None
        }))
    );
    model.apply(Response::Confirm);
    assert_eq!(model.screen, Screen::Confirm);
    assert_eq!(model.key(Key::Run, 20), None);
    assert_eq!(model.key(Key::Esc, 20), None);
    assert_eq!(model.screen, Screen::Sql);
    model.key(Key::Run, 20);
    model.apply(Response::Confirm);
    model.key(Key::Char('P'), 20);
    model.paste("rod");
    assert_eq!(
        model.key(Key::Enter, 20),
        Some(Effect::Request(Request::Run {
            sql: "delete from kunde".into(),
            answer: Some("Prod".into())
        }))
    );
    model.apply(Response::Failed(
        "Nicht bestätigt, nichts ausgeführt.".into(),
    ));
    assert_eq!(model.screen, Screen::Sql);
    assert!(model.failed);
}

#[test]
fn busy_state_allows_only_cancelling() {
    let mut model = opened(3);
    assert!(matches!(
        model.key(Key::Enter, 20),
        Some(Effect::Request(Request::Rows { .. }))
    ));
    for key in [
        Key::Enter,
        Key::Char('d'),
        Key::Char('q'),
        Key::Char('m'),
        Key::Run,
        Key::Esc,
        Key::Down,
    ] {
        assert_eq!(model.key(key, 20), None, "{key:?}");
    }
    assert_eq!(model.open(1), None);
    assert_eq!(model.key(Key::Interrupt, 20), Some(Effect::Cancel));
    assert_eq!(model.key(Key::Interrupt, 20), Some(Effect::Cancel));
    model.apply(Response::Failed("Abgebrochen.".into()));
    assert!(model.busy.is_none());
    assert_eq!(model.screen, Screen::Objects);
    assert_eq!(model.key(Key::Interrupt, 20), Some(Effect::Quit));
}

#[test]
fn perf_scrolling_is_bounded_and_never_queries() {
    let object = objects(1).remove(0);
    let mut model = opened(1);
    model.key(Key::Enter, 40);
    model.apply(Response::Rows {
        object: object.clone(),
        columns: names(60),
        rows: rows(PAGE, 60, 0),
        offset: 0,
    });
    let mut requests = 1;
    while model.more {
        let effect = model.key(Key::Char('m'), 40);
        let Some(Effect::Request(Request::Rows { offset, .. })) = effect else {
            panic!("{effect:?}");
        };
        assert_eq!(offset, model.table.len());
        requests += 1;
        model.apply(Response::Rows {
            object: object.clone(),
            columns: names(60),
            rows: rows(PAGE, 60, offset),
            offset,
        });
    }
    assert_eq!(requests, MAX_ROWS / PAGE);
    assert_eq!(model.table.len(), MAX_ROWS);
    assert_eq!(model.key(Key::Char('m'), 40), None);

    let keys = [
        Key::Down,
        Key::Down,
        Key::PageDown,
        Key::Right,
        Key::Up,
        Key::PageUp,
        Key::End,
        Key::Left,
        Key::Home,
    ];
    let (width, height) = (200, 50);
    let mut frames = Vec::new();
    let mut cells = 0;
    for step in 0..5000 {
        let started = Instant::now();
        assert_eq!(model.key(keys[step % keys.len()], height), None);
        let header = model.table.header(width);
        let body = model.table.body(width, height);
        frames.push(started.elapsed().as_secs_f64() * 1000.0);
        assert!(body.len() <= height && header.width() <= width);
        cells = cells.max(body.iter().map(|line| line.len()).sum::<usize>());
    }
    let (median, p95) = percentiles(frames);
    println!(
        "TUI-Raster {MAX_ROWS}x60, Ansicht {width}x{height}, 5000 Scrollschritte: median {median:.3} ms, p95 {p95:.3} ms, höchstens {cells} Bytes je Bild, 0 Datenbankabfragen"
    );
    assert!(cells <= width * height * 4);
    assert!(p95 < 4.0, "p95 {p95} ms");

    let mut huge = Grid::new(names(20), rows(100_000, 20, 0));
    let mut frames = Vec::new();
    for step in 0..2000 {
        let started = Instant::now();
        huge.scroll(
            if step % 3 == 0 {
                Move::PageDown
            } else {
                Move::Down
            },
            height,
        );
        let body = huge.body(width, height);
        frames.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(body.len(), height);
    }
    let (median, huge_p95) = percentiles(frames);
    println!(
        "TUI-Raster 100000x20 (Kontrolle, Bildzeit unabhängig von der Zeilenzahl): median {median:.3} ms, p95 {huge_p95:.3} ms"
    );
    assert!(huge_p95 < 4.0, "p95 {huge_p95} ms");
}

#[test]
fn perf_object_filter_handles_large_catalogs() {
    let mut model = opened(20_000);
    model.key(Key::Char('/'), 40);
    let mut samples = Vec::new();
    for c in "tabelle_1999".chars() {
        let started = Instant::now();
        assert_eq!(model.key(Key::Char(c), 40), None);
        let shown = model.visible().len();
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
        assert!(shown >= 1);
    }
    for _ in 0..200 {
        let started = Instant::now();
        assert_eq!(model.key(Key::PageDown, 40), None);
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    let (median, p95) = percentiles(samples);
    println!("TUI-Objektliste 20000 Tabellen, Filtern und Blättern: median {median:.3} ms, p95 {p95:.3} ms, 0 Datenbankabfragen");
    assert!(p95 < 20.0, "p95 {p95} ms");
}

#[tokio::test]
async fn perf_rendered_frames_scroll_a_full_result() {
    let mut model = opened(1);
    model.key(Key::Char('s'), 40);
    model.sql = "select * from kunde".into();
    model.apply(Response::Results {
        grid: Some((names(60), rows(MAX_ROWS, 60, 0))),
        status: "Erste 1000 Zeilen · 12 ms".into(),
    });
    let press = |code| TerminalEvent::Key(KeyEvent::new(KeyEventKind::Press, code));
    let mut events = vec![TerminalEvent::Resize(200, 50)];
    for step in 0..300 {
        events.push(press(match step % 6 {
            0 | 1 => KeyCode::Down,
            2 => KeyCode::PageDown,
            3 => KeyCode::Right,
            4 => KeyCode::Up,
            _ => KeyCode::Left,
        }));
    }
    events.push(press(KeyCode::Char('q')));
    let mut app = element! {
        App(initial: Some(Arc::new(Mutex::new(Some(model)))))
    };
    let mut frames = app.mock_terminal_render_loop(MockTerminalConfig::with_events(
        stream::iter(events).then(|event| async move {
            tokio::task::yield_now().await;
            event
        }),
    ));
    let started = Instant::now();
    let mut frames_seen = 0;
    let mut last = String::new();
    while let Some(canvas) = frames.next().await {
        frames_seen += 1;
        assert!(canvas.width() <= 200 && canvas.height() <= 50);
        last = canvas.to_string();
    }
    let mean = started.elapsed().as_secs_f64() * 1000.0 / frames_seen as f64;
    assert!(frames_seen > 50, "nur {frames_seen} Bilder");
    assert!(
        last.contains("spalte_") && last.contains("von 1000"),
        "{last}"
    );
    println!(
        "TUI-Bilder (iocraft, 200x50, Ergebnis {MAX_ROWS}x60, 300 Tasten): {frames_seen} Bilder, im Mittel {mean:.2} ms je Bild"
    );
    assert!(mean < 50.0, "Mittel {mean} ms");
}
