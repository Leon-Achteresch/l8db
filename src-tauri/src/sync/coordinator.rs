use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Runtime;

const LEASE: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
struct Coordinator {
    leader: Option<String>,
    active: Option<(String, Instant)>,
}

static STATE: Mutex<Coordinator> = Mutex::new(Coordinator {
    leader: None,
    active: None,
});

fn with<T>(f: impl FnOnce(&mut Coordinator) -> T) -> T {
    let mut guard = STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut guard)
}

fn claim(state: &mut Coordinator, label: &str, alive: impl Fn(&str) -> bool) -> bool {
    match state.leader.as_deref() {
        Some(current) if current == label => true,
        Some(current) if alive(current) => false,
        _ => {
            state.leader = Some(label.to_string());
            true
        }
    }
}

fn start(state: &mut Coordinator, label: &str, now: Instant, alive: impl Fn(&str) -> bool) -> bool {
    match &state.active {
        Some((owner, since))
            if owner != label && now.duration_since(*since) < LEASE && alive(owner) =>
        {
            false
        }
        _ => {
            state.active = Some((label.to_string(), now));
            true
        }
    }
}

fn finish(state: &mut Coordinator, label: &str) {
    if state
        .active
        .as_ref()
        .is_some_and(|(owner, _)| owner == label)
    {
        state.active = None;
    }
}

fn forget(state: &mut Coordinator, label: &str) {
    if state.leader.as_deref() == Some(label) {
        state.leader = None;
    }
    finish(state, label);
}

pub fn claim_leader(label: &str, alive: impl Fn(&str) -> bool) -> bool {
    with(|state| claim(state, label, alive))
}

pub fn release_leader(label: &str) {
    with(|state| {
        if state.leader.as_deref() == Some(label) {
            state.leader = None;
        }
    });
}

pub fn begin(label: &str, alive: impl Fn(&str) -> bool) -> bool {
    with(|state| start(state, label, Instant::now(), alive))
}

pub fn end(label: &str) {
    with(|state| finish(state, label));
}

pub fn forget_window<R: Runtime>(window: &tauri::Window<R>) {
    with(|state| forget(state, window.label()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_leader_until_it_disappears() {
        let mut state = Coordinator::default();
        assert!(claim(&mut state, "main", |_| true));
        assert!(!claim(&mut state, "win-1", |_| true));
        assert!(claim(&mut state, "main", |_| true));
        assert!(claim(&mut state, "win-1", |label| label != "main"));
        forget(&mut state, "win-1");
        assert!(claim(&mut state, "main", |_| true));
    }

    #[test]
    fn single_sync_in_flight_with_stale_lease_recovery() {
        let mut state = Coordinator::default();
        let now = Instant::now();
        assert!(start(&mut state, "main", now, |_| true));
        assert!(!start(&mut state, "win-1", now, |_| true));
        assert!(start(&mut state, "main", now, |_| true));
        finish(&mut state, "win-1");
        assert!(!start(&mut state, "win-1", now, |_| true));
        assert!(start(&mut state, "win-1", now + LEASE, |_| true));
        finish(&mut state, "win-1");
        assert!(start(&mut state, "main", now, |_| true));
        assert!(start(&mut state, "win-1", now, |label| label != "main"));
    }

    #[test]
    fn closing_a_window_releases_its_lease_and_leadership() {
        let mut state = Coordinator::default();
        let now = Instant::now();
        assert!(claim(&mut state, "win-1", |_| true));
        assert!(start(&mut state, "win-1", now, |_| true));
        forget(&mut state, "win-1");
        assert!(start(&mut state, "main", now, |_| true));
        assert!(claim(&mut state, "main", |_| true));
    }
}
