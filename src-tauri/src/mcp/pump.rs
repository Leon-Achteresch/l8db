use futures_util::{stream::FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use tokio::sync::mpsc::Receiver;

pub(super) const PARALLEL: usize = 4;
const QUEUE: usize = 64;
const SHARED_TOOLS: &[&str] = &[
    "connections",
    "overview",
    "search",
    "describe",
    "relations",
    "explain",
    "drilldown",
    "query",
    "code",
    "health",
];

fn shared(request: &Value) -> bool {
    request["method"] != "tools/call"
        || (SHARED_TOOLS.contains(&request["params"]["name"].as_str().unwrap_or(""))
            && request["params"]["arguments"]["refresh"] != true)
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

pub(super) async fn pump<H, F>(
    mut lines: Receiver<String>,
    handle: H,
    mut emit: impl FnMut(Value) -> bool,
) where
    H: Fn(String) -> F,
    F: Future<Output = Option<Value>> + Send + 'static,
{
    let mut waiting: VecDeque<(String, Value)> = VecDeque::new();
    let mut running = FuturesUnordered::new();
    let mut aborts: HashMap<String, tokio::task::AbortHandle> = HashMap::new();
    let mut alone = false;
    let mut open = true;
    loop {
        while let Some((_, request)) = waiting.front() {
            let exclusive = !shared(request);
            if alone || running.len() >= PARALLEL || (exclusive && !running.is_empty()) {
                break;
            }
            let Some((line, request)) = waiting.pop_front() else {
                break;
            };
            alone = exclusive;
            let id = request.get("id").cloned();
            let task = tokio::spawn(handle(line));
            if let Some(id) = &id {
                aborts.insert(id.to_string(), task.abort_handle());
            }
            running.push(async move { (id, task.await) });
        }
        if !open && running.is_empty() && waiting.is_empty() {
            return;
        }
        tokio::select! {
            Some((id, outcome)) = running.next() => {
                alone = false;
                if let Some(id) = &id {
                    aborts.remove(&id.to_string());
                }
                let response = match outcome {
                    Ok(response) => response,
                    Err(failure) if failure.is_cancelled() => {
                        id.map(|id| error(id, -32800, "Anfrage abgebrochen"))
                    }
                    Err(_) => id.map(|id| error(id, -32603, "Interner Fehler")),
                };
                if let Some(response) = response {
                    if !emit(response) {
                        return;
                    }
                }
            }
            incoming = lines.recv(), if open && waiting.len() < QUEUE => {
                let Some(line) = incoming else {
                    open = false;
                    continue;
                };
                if line.trim().is_empty() {
                    continue;
                }
                let request = serde_json::from_str::<Value>(&line).unwrap_or(Value::Null);
                if request["method"] == "notifications/cancelled" {
                    let Some(id) = request["params"].get("requestId") else {
                        continue;
                    };
                    if let Some(abort) = aborts.get(&id.to_string()) {
                        abort.abort();
                        continue;
                    }
                    let queued = waiting.len();
                    waiting.retain(|(_, waiting)| waiting.get("id") != Some(id));
                    if waiting.len() < queued
                        && !emit(error(id.clone(), -32800, "Anfrage abgebrochen"))
                    {
                        return;
                    }
                    continue;
                }
                if request.is_null() || request.get("method").is_some() {
                    waiting.push_back((line, request));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    fn call(id: u64, tool: &str) -> String {
        json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": tool}})
            .to_string()
    }

    fn cancel(id: u64) -> String {
        json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": id}})
            .to_string()
    }

    fn done(id: &Value) -> Option<Value> {
        Some(json!({"jsonrpc": "2.0", "id": id, "result": {}}))
    }

    async fn collect<H, F>(lines: Vec<String>, handle: H) -> Vec<Value>
    where
        H: Fn(String) -> F,
        F: Future<Output = Option<Value>> + Send + 'static,
    {
        let (input, receiver) = tokio::sync::mpsc::channel(256);
        for line in lines {
            input.send(line).await.unwrap();
        }
        drop(input);
        let mut out = Vec::new();
        pump(receiver, handle, |response| {
            out.push(response);
            true
        })
        .await;
        out
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn read_calls_overlap_up_to_the_limit_and_finish_in_the_time_of_one() {
        const WORK: Duration = Duration::from_millis(100);
        let mut walls = Vec::new();
        let peak = Arc::new(AtomicUsize::new(0));
        for _ in 0..5 {
            let active = Arc::new(AtomicUsize::new(0));
            let (active, peak) = (active.clone(), peak.clone());
            let lines = [
                "describe",
                "code",
                "code",
                "query",
                "search",
                "overview",
                "relations",
                "health",
            ]
            .iter()
            .enumerate()
            .map(|(index, tool)| call(index as u64, tool))
            .collect();
            let started = Instant::now();
            let out = collect(lines, move |line| {
                let (active, peak) = (active.clone(), peak.clone());
                async move {
                    peak.fetch_max(active.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
                    tokio::time::sleep(WORK).await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    done(&serde_json::from_str::<Value>(&line).unwrap()["id"])
                }
            })
            .await;
            walls.push(started.elapsed());
            assert_eq!(out.len(), 8);
        }
        walls.sort();
        let (median, slowest) = (walls[2], walls[4]);
        println!(
            "mcp pump: 8 read calls of {} ms, {PARALLEL} parallel: median {} ms, max {} ms (sequential: 800 ms)",
            WORK.as_millis(),
            median.as_millis(),
            slowest.as_millis()
        );
        assert_eq!(peak.load(Ordering::SeqCst), PARALLEL);
        assert!(median < WORK * 3, "median {median:?}");
        assert!(slowest < WORK * 5, "max {slowest:?}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn writes_run_alone_and_keep_their_place_in_the_order() {
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let log = events.clone();
        let lines = vec![
            call(1, "query"),
            call(2, "describe"),
            call(3, "execute"),
            call(4, "query"),
            call(5, "script"),
            call(6, "code"),
        ];
        let out = collect(lines, move |line| {
            let log = log.clone();
            async move {
                let id = serde_json::from_str::<Value>(&line).unwrap()["id"].clone();
                log.lock().unwrap().push(format!("start {id}"));
                tokio::time::sleep(Duration::from_millis(20)).await;
                log.lock().unwrap().push(format!("end {id}"));
                done(&id)
            }
        })
        .await;
        assert_eq!(out.len(), 6);
        let events = events.lock().unwrap().clone();
        let at = |event: &str| events.iter().position(|seen| seen == event).unwrap();
        assert!(at("start 3") > at("end 1").max(at("end 2")));
        assert!(at("end 3") < at("start 4"));
        assert!(at("end 4") < at("start 5"));
        assert!(at("end 5") < at("start 6"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn cancellation_stops_running_and_queued_calls_and_idle_work_ends() {
        struct Dropped(Arc<AtomicUsize>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
        let dropped = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(AtomicUsize::new(0));
        let (input, receiver) = tokio::sync::mpsc::channel(16);
        let (dropped_in, started_in) = (dropped.clone(), started.clone());
        let out = Arc::new(Mutex::new(Vec::<Value>::new()));
        let seen = out.clone();
        let pumping = tokio::spawn(pump(
            receiver,
            move |line| {
                let (dropped, started) = (dropped_in.clone(), started_in.clone());
                async move {
                    let request = serde_json::from_str::<Value>(&line).unwrap();
                    if request["method"] != "tools/call" {
                        return None;
                    }
                    started.fetch_add(1, Ordering::SeqCst);
                    let _dropped = Dropped(dropped);
                    std::future::pending::<()>().await;
                    None
                }
            },
            move |response| {
                seen.lock().unwrap().push(response);
                true
            },
        ));
        input.send(call(1, "execute")).await.unwrap();
        input.send(call(2, "query")).await.unwrap();
        while started.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        input
            .send(json!({"jsonrpc": "2.0", "id": 9, "result": {}}).to_string())
            .await
            .unwrap();
        input.send(cancel(2)).await.unwrap();
        input.send(cancel(1)).await.unwrap();
        input.send(cancel(7)).await.unwrap();
        drop(input);
        tokio::time::timeout(Duration::from_secs(5), pumping)
            .await
            .expect("pump ends once nothing is running")
            .unwrap();
        let out = out.lock().unwrap().clone();
        assert_eq!(
            out.iter()
                .map(|response| (
                    response["id"].as_u64().unwrap(),
                    response["error"]["code"].as_i64().unwrap()
                ))
                .collect::<Vec<_>>(),
            vec![(2, -32800), (1, -32800)]
        );
        assert_eq!(started.load(Ordering::SeqCst), 1);
        assert_eq!(dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn only_plain_reads_share_the_server() {
        let request = |tool: &str, arguments: Value| json!({"method": "tools/call", "params": {"name": tool, "arguments": arguments}});
        assert!(shared(&request("search", json!({"term": "a"}))));
        assert!(!shared(&request("search", json!({"refresh": true}))));
        assert!(!shared(&request("execute", json!({}))));
        assert!(!shared(&request("unknown", json!({}))));
        assert!(shared(&json!({"method": "tools/list"})));
    }

    #[tokio::test]
    async fn a_panicking_call_reports_an_error_and_the_next_one_still_runs() {
        let out = collect(
            vec![call(1, "query"), call(2, "query")],
            |line| async move {
                let id = serde_json::from_str::<Value>(&line).unwrap()["id"].clone();
                assert_ne!(id, json!(1), "boom");
                done(&id)
            },
        )
        .await;
        let code = |id: u64| {
            out.iter()
                .find(|response| response["id"] == json!(id))
                .map(|response| response["error"]["code"].clone())
        };
        assert_eq!(code(1), Some(json!(-32603)));
        assert_eq!(code(2), Some(Value::Null));
    }
}
