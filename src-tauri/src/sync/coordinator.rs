use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Runtime;

const LEASE: Duration = Duration::from_secs(10 * 60);

struct Lease {
    owner: String,
    token: String,
    since: Instant,
}

#[derive(Default)]
struct Coordinator {
    leader: Option<String>,
    active: Option<Lease>,
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

fn new_token() -> String {
    format!("{:032x}", rand::random::<u128>())
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

fn start(
    state: &mut Coordinator,
    label: &str,
    now: Instant,
    alive: impl Fn(&str) -> bool,
) -> Option<String> {
    if let Some(lease) = &state.active {
        if now.duration_since(lease.since) < LEASE && alive(&lease.owner) {
            return None;
        }
    }
    let token = new_token();
    state.active = Some(Lease {
        owner: label.to_string(),
        token: token.clone(),
        since: now,
    });
    Some(token)
}

fn finish(state: &mut Coordinator, token: &str) -> bool {
    if state
        .active
        .as_ref()
        .is_some_and(|lease| lease.token == token)
    {
        state.active = None;
        return true;
    }
    false
}

fn forget(state: &mut Coordinator, label: &str) {
    if state.leader.as_deref() == Some(label) {
        state.leader = None;
    }
    if state
        .active
        .as_ref()
        .is_some_and(|lease| lease.owner == label)
    {
        state.active = None;
    }
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

pub fn begin(label: &str, alive: impl Fn(&str) -> bool) -> Option<String> {
    with(|state| start(state, label, Instant::now(), alive))
}

pub fn end(token: &str) -> bool {
    with(|state| finish(state, token))
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
        let first = start(&mut state, "main", now, |_| true).unwrap();
        assert!(start(&mut state, "win-1", now, |_| true).is_none());
        assert!(start(&mut state, "main", now, |_| true).is_none());
        let expired = start(&mut state, "win-1", now + LEASE, |_| true).unwrap();
        assert!(!finish(&mut state, &first));
        assert!(finish(&mut state, &expired));
        assert!(start(&mut state, "win-1", now, |label| label != "main").is_some());
    }

    #[test]
    fn a_reloaded_window_cannot_release_another_acquisition() {
        let mut state = Coordinator::default();
        let now = Instant::now();
        let stale = start(&mut state, "main", now, |_| true).unwrap();
        let fresh = start(&mut state, "main", now + LEASE, |_| true).unwrap();
        assert_ne!(stale, fresh);
        assert!(!finish(&mut state, &stale));
        assert!(start(&mut state, "win-1", now + LEASE, |_| true).is_none());
        assert!(!finish(&mut state, "geraten"));
        assert!(finish(&mut state, &fresh));
    }

    #[test]
    fn closing_a_window_releases_its_lease_and_leadership() {
        let mut state = Coordinator::default();
        let now = Instant::now();
        assert!(claim(&mut state, "win-1", |_| true));
        assert!(start(&mut state, "win-1", now, |_| true).is_some());
        forget(&mut state, "win-1");
        assert!(start(&mut state, "main", now, |_| true).is_some());
        assert!(claim(&mut state, "main", |_| true));
    }
}
