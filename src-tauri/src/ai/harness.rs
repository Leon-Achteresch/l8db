use super::types::Profile;
use serde_json::{json, Value};

pub const MAX_ROUNDS: usize = 40;
const WRAP_UP_ROUNDS: usize = 3;
const REPEAT_STREAK: usize = 3;
const MAX_STEPS: usize = 12;
const KEEP_ROUNDS: usize = 2;
const CHARS_PER_TOKEN: usize = 3;
const SOFT_CAP: usize = 120_000;
const HARD_CAP: usize = 200_000;
const DIGEST_CHARS: usize = 12_000;
const SUMMARY_OPEN: &str = "<context-summary>";
const SUMMARY_CLOSE: &str = "</context-summary>";

pub fn plan_definition() -> Value {
    json!({
        "name": "plan",
        "description": "Keep a short plan for work with three or more steps, such as investigations, migrations or performance tuning. Send the complete list every time; exactly one step in_progress; mark a step completed as soon as it is done. The user sees the plan. Skip it for single questions.",
        "inputSchema": {"type": "object", "properties": {
            "steps": {"type": "array", "minItems": 1, "maxItems": MAX_STEPS, "items": {"type": "object", "properties": {
                "step": {"type": "string", "description": "Short step in the user's language"},
                "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]}
            }, "required": ["step", "status"]}}
        }, "required": ["steps"]}
    })
}

#[derive(Default)]
pub struct Plan {
    steps: Vec<(String, String)>,
}

impl Plan {
    pub fn update(&mut self, args: &Value) -> Result<String, String> {
        let steps = args["steps"]
            .as_array()
            .filter(|steps| !steps.is_empty() && steps.len() <= MAX_STEPS)
            .ok_or(format!("steps must contain 1 to {MAX_STEPS} entries"))?;
        let mut parsed = Vec::with_capacity(steps.len());
        for entry in steps {
            let step = entry["step"].as_str().unwrap_or("").trim();
            if step.is_empty() {
                return Err("every step needs text".into());
            }
            let status = match entry["status"].as_str().unwrap_or("pending") {
                "in-progress" | "inProgress" => "in_progress",
                status @ ("pending" | "in_progress" | "completed") => status,
                other => return Err(format!("unknown status '{other}'")),
            };
            parsed.push((step.chars().take(200).collect(), status.to_string()));
        }
        if parsed
            .iter()
            .filter(|(_, status)| status == "in_progress")
            .count()
            > 1
        {
            return Err("only one step may be in_progress".into());
        }
        self.steps = parsed;
        Ok(format!("Plan saved:\n{}", self.render()))
    }

    pub fn render(&self) -> String {
        self.steps
            .iter()
            .map(|(step, status)| {
                let mark = match status.as_str() {
                    "completed" => "[x]",
                    "in_progress" => "[>]",
                    _ => "[ ]",
                };
                format!("{mark} {step}")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn event(&self) -> Value {
        json!({"plan": self.steps.iter().map(|(step, status)| json!({"step": step, "status": status})).collect::<Vec<_>>()})
    }
}

pub fn guided(profile: &Profile) -> bool {
    matches!(
        profile.provider.as_str(),
        "ollama" | "lmstudio" | "compatible"
    )
}

pub const GUIDED_REMINDER: &str = "\n\n[l8db] If this needs three or more steps, call plan first, then work through it step by step. Answer directly if it is a single question.";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Budget {
    pub soft: usize,
    pub hard: usize,
}

impl Budget {
    pub fn for_profile(profile: &Profile, overhead: usize) -> Self {
        let tokens = profile
            .pricing
            .as_ref()
            .and_then(|pricing| pricing.context_window)
            .filter(|window| *window >= 4_000)
            .map(|window| window as usize)
            .unwrap_or(match profile.provider.as_str() {
                "anthropic" => 200_000,
                "google" => 1_000_000,
                "ollama" | "lmstudio" => 32_000,
                _ => 128_000,
            });
        let window = tokens
            .saturating_mul(CHARS_PER_TOKEN)
            .saturating_sub(overhead);
        let soft = (window * 6 / 10).clamp(8_000, SOFT_CAP);
        let hard = (window * 85 / 100).clamp(soft + 4_000, HARD_CAP.max(soft + 4_000));
        Self { soft, hard }
    }
}

pub fn size(messages: &[Value]) -> usize {
    messages.iter().map(super::byok::message_size).sum()
}

fn first_line(text: &str, max: usize) -> String {
    let line = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    if line.chars().count() > max {
        format!("{}…", line.chars().take(max).collect::<String>())
    } else {
        line.to_string()
    }
}

fn arguments(call: &Value) -> String {
    let raw = call["function"]["arguments"].as_str().unwrap_or("{}");
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > 240 {
        format!("{}…", flat.chars().take(240).collect::<String>())
    } else {
        flat
    }
}

fn digest_round(messages: &[Value]) -> Vec<String> {
    let mut lines = Vec::new();
    let Some(assistant) = messages.first() else {
        return lines;
    };
    let said = first_line(assistant["content"].as_str().unwrap_or(""), 200);
    if !said.is_empty() {
        lines.push(format!("- said: {said}"));
    }
    for call in assistant["tool_calls"].as_array().into_iter().flatten() {
        let id = &call["id"];
        let name = call["function"]["name"].as_str().unwrap_or("?");
        let result = messages
            .iter()
            .find(|message| message["role"] == "tool" && &message["tool_call_id"] == id);
        let (status, outcome) = match result {
            Some(message) => {
                let text = match &message["content"] {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                };
                let failed = message["isError"] == true || text.starts_with("[tool error]");
                let text = text.trim_start_matches("[tool error]").trim_start();
                (if failed { "error" } else { "ok" }, first_line(text, 160))
            }
            None => ("no result", String::new()),
        };
        lines.push(format!(
            "- {name} {} -> {status}: {outcome}",
            arguments(call)
        ));
    }
    lines
}

fn replace_summary(content: &str, digest: &str) -> String {
    let base = match (content.find(SUMMARY_OPEN), content.find(SUMMARY_CLOSE)) {
        (Some(start), Some(end)) if end > start => {
            let mut base = content[..start].trim_end().to_string();
            base.push_str(&content[end + SUMMARY_CLOSE.len()..]);
            base
        }
        _ => content.to_string(),
    };
    format!("{base}\n\n{SUMMARY_OPEN}\n{digest}\n{SUMMARY_CLOSE}")
}

fn previous_digest(content: &str) -> Vec<String> {
    match (content.find(SUMMARY_OPEN), content.find(SUMMARY_CLOSE)) {
        (Some(start), Some(end)) if end > start => content[start + SUMMARY_OPEN.len()..end]
            .lines()
            .filter(|line| line.starts_with("- "))
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

pub fn collapse(messages: &mut Vec<Value>, start: usize, hard: usize, plan: &Plan) -> usize {
    if start == 0 || start > messages.len() || size(messages) <= hard {
        return 0;
    }
    let rounds: Vec<usize> = (start..messages.len())
        .filter(|index| {
            messages[*index]["role"] == "assistant"
                && messages[*index]["tool_calls"]
                    .as_array()
                    .is_some_and(|calls| !calls.is_empty())
        })
        .collect();
    if rounds.len() <= KEEP_ROUNDS || rounds[0] != start {
        return 0;
    }
    let mut total = size(messages);
    let mut end = start;
    let mut removed = 0;
    for (position, round) in rounds.iter().enumerate() {
        if total <= hard || rounds.len() - position <= KEEP_ROUNDS {
            break;
        }
        let next = rounds[position + 1];
        total -= size(&messages[*round..next]);
        end = next;
        removed += 1;
    }
    if removed == 0 {
        return 0;
    }
    let anchor = start - 1;
    let content = messages[anchor]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let mut lines = previous_digest(&content);
    for (position, round) in rounds.iter().take(removed).enumerate() {
        lines.extend(digest_round(&messages[*round..rounds[position + 1]]));
    }
    let mut digest = String::new();
    for line in lines.iter().rev() {
        if digest.len() + line.len() + 1 > DIGEST_CHARS {
            break;
        }
        digest.insert_str(0, &format!("{line}\n"));
    }
    let mut text = format!(
        "Earlier tool rounds of this request were compacted. Re-run a call if you need its full result.\n{}",
        digest.trim_end()
    );
    if !plan.is_empty() {
        text.push_str(&format!("\nCurrent plan:\n{}", plan.render()));
    }
    messages[anchor]["content"] = json!(replace_summary(&content, &text));
    messages.drain(start..end);
    removed
}

pub fn note(messages: &mut [Value], text: &str) {
    if let Some(message) = messages.last_mut() {
        let content = match &message["content"] {
            Value::String(content) => content.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        };
        message["content"] = json!(format!("{content}{text}"));
    }
}

pub fn round_note(round: usize) -> Option<String> {
    let left = MAX_ROUNDS.saturating_sub(round);
    if round == MAX_ROUNDS {
        Some("\n\n[l8db] The tool budget for this request is used up. Answer now with what you have and say what is still open.".into())
    } else if left == WRAP_UP_ROUNDS {
        Some(format!("\n\n[l8db] {left} tool rounds left in this request. Finish the current step and prepare the answer."))
    } else {
        None
    }
}

pub fn forbid_tools(provider: &str, body: &mut Value) {
    match provider {
        "anthropic" => body["tool_choice"] = json!({"type": "none"}),
        "google" => body["toolConfig"] = json!({"functionCallingConfig": {"mode": "NONE"}}),
        _ => body["tool_choice"] = json!("none"),
    }
}

#[derive(Default)]
pub struct Repeats {
    last: Option<String>,
    streak: usize,
}

impl Repeats {
    pub fn record(&mut self, key: &str, failed: bool, name: &str) -> Option<String> {
        if self.last.as_deref() == Some(key) {
            self.streak += 1;
        } else {
            self.last = Some(key.to_string());
            self.streak = 1;
        }
        (!failed && self.streak == REPEAT_STREAK).then(|| {
            format!("\n[l8db] You called {name} with the same arguments {REPEAT_STREAK} times and already have this result. Move on to the next step or answer.")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn profile(provider: &str, window: Option<u64>) -> Profile {
        serde_json::from_value(json!({
            "id": "p", "provider": provider, "model": "m",
            "pricing": window.map(|window| json!({"model": "m", "contextWindow": window}))
        }))
        .unwrap()
    }

    fn round(index: usize, chars: usize, failed: bool) -> Vec<Value> {
        vec![
            json!({"role": "assistant", "content": format!("step {index}"), "tool_calls": [{"id": format!("c{index}"), "type": "function", "function": {"name": "query", "arguments": format!("{{\"sql\": \"SELECT {index}\"}}")}}]}),
            json!({"role": "tool", "tool_call_id": format!("c{index}"), "name": "query", "content": format!("{}id\n{}", if failed { "[tool error]\n" } else { "" }, "1\n".repeat(chars / 2)), "isError": failed}),
        ]
    }

    fn conversation(rounds: usize, chars: usize) -> Vec<Value> {
        let mut messages = vec![
            json!({"role": "user", "content": "earlier question"}),
            json!({"role": "assistant", "content": "earlier answer"}),
            json!({"role": "user", "content": "Find slow orders"}),
        ];
        for index in 0..rounds {
            messages.extend(round(index, chars, index == 1));
        }
        messages
    }

    #[test]
    fn plan_validates_renders_and_emits_steps() {
        let mut plan = Plan::default();
        assert!(plan.update(&json!({"steps": []})).is_err());
        assert!(plan
            .update(&json!({"steps": [{"step": "a", "status": "in_progress"}, {"step": "b", "status": "in_progress"}]}))
            .unwrap_err()
            .contains("one step"));
        assert!(plan
            .update(&json!({"steps": [{"step": " ", "status": "pending"}]}))
            .is_err());
        let text = plan
            .update(&json!({"steps": [
                {"step": "Schema prüfen", "status": "completed"},
                {"step": "Plan lesen", "status": "in-progress"},
                {"step": "Index vorschlagen", "status": "pending"}
            ]}))
            .unwrap();
        assert_eq!(
            text,
            "Plan saved:\n[x] Schema prüfen\n[>] Plan lesen\n[ ] Index vorschlagen"
        );
        assert_eq!(plan.event()["plan"][1]["status"], "in_progress");
        assert!(plan_definition()["inputSchema"]["properties"]["steps"]["maxItems"] == MAX_STEPS);
    }

    #[test]
    fn budget_follows_the_model_window_and_caps_cost() {
        let local = Budget::for_profile(&profile("ollama", None), 15_000);
        assert_eq!(local.soft, (96_000 - 15_000) * 6 / 10);
        assert_eq!(local.hard, (96_000 - 15_000) * 85 / 100);
        let large = Budget::for_profile(&profile("anthropic", None), 15_000);
        assert_eq!(
            large,
            Budget {
                soft: SOFT_CAP,
                hard: HARD_CAP
            }
        );
        let tiny = Budget::for_profile(&profile("compatible", Some(8_192)), 30_000);
        assert!(tiny.soft >= 8_000 && tiny.hard >= tiny.soft + 4_000);
        let custom = Budget::for_profile(&profile("openai", Some(16_000)), 0);
        assert_eq!(custom.soft, 28_800);
        assert!(guided(&profile("ollama", None)) && !guided(&profile("anthropic", None)));
    }

    #[test]
    fn collapse_keeps_preamble_and_recent_rounds_and_digests_the_rest() {
        let mut messages = conversation(6, 4_000);
        let original = messages.clone();
        let mut plan = Plan::default();
        plan.update(&json!({"steps": [{"step": "find", "status": "in_progress"}]}))
            .unwrap();
        assert_eq!(collapse(&mut messages, 3, 10_000_000, &plan), 0);
        assert_eq!(messages, original);
        let removed = collapse(&mut messages, 3, 12_000, &plan);
        assert_eq!(removed, 4);
        assert_eq!(messages.len(), 3 + 4);
        assert_eq!(messages[..2], original[..2]);
        assert_eq!(messages[3..], original[11..]);
        let anchor = messages[2]["content"].as_str().unwrap();
        assert!(
            anchor.starts_with("Find slow orders\n\n<context-summary>"),
            "{anchor}"
        );
        assert!(anchor.contains("- said: step 0"));
        assert!(
            anchor.contains("- query {\"sql\": \"SELECT 0\"} -> ok: id"),
            "{anchor}"
        );
        assert!(
            anchor.contains("- query {\"sql\": \"SELECT 1\"} -> error: id"),
            "{anchor}"
        );
        assert!(anchor.contains("Current plan:\n[>] find"));
        assert!(size(&messages) <= 12_000);
        messages.extend(round(6, 4_000, false));
        messages.extend(round(7, 4_000, false));
        let again = collapse(&mut messages, 3, 12_000, &plan);
        assert_eq!(again, 2);
        let anchor = messages[2]["content"].as_str().unwrap();
        assert_eq!(anchor.matches(SUMMARY_OPEN).count(), 1);
        assert!(
            anchor.contains("SELECT 0") && anchor.contains("SELECT 5"),
            "{anchor}"
        );
        assert_eq!(messages[3]["tool_calls"][0]["id"], "c6");
    }

    #[test]
    fn collapse_never_breaks_tool_pairs_or_touches_older_turns() {
        let mut messages = conversation(2, 50_000);
        assert_eq!(collapse(&mut messages, 3, 1_000, &Plan::default()), 0);
        let mut messages = conversation(5, 50_000);
        collapse(&mut messages, 3, 1_000, &Plan::default());
        for (index, message) in messages.iter().enumerate() {
            if message["role"] == "tool" {
                assert_eq!(
                    messages[index - 1]["tool_calls"][0]["id"],
                    message["tool_call_id"]
                );
            }
        }
        assert_eq!(messages[3]["role"], "assistant");
        assert_eq!(
            collapse(&mut conversation(5, 50_000), 0, 1_000, &Plan::default()),
            0
        );
    }

    #[test]
    fn repeats_warn_once_per_streak_and_rounds_announce_the_budget() {
        let mut repeats = Repeats::default();
        assert!(repeats.record("a", false, "query").is_none());
        assert!(repeats.record("a", false, "query").is_none());
        assert!(repeats
            .record("a", false, "query")
            .unwrap()
            .contains("3 times"));
        assert!(repeats.record("a", false, "query").is_none());
        assert!(repeats.record("b", false, "query").is_none());
        assert!(repeats.record("b", true, "query").is_none());
        assert!(repeats.record("b", true, "query").is_none());
        assert!(round_note(1).is_none());
        assert!(round_note(MAX_ROUNDS - WRAP_UP_ROUNDS)
            .unwrap()
            .contains("3 tool rounds left"));
        assert!(round_note(MAX_ROUNDS).unwrap().contains("used up"));
        let mut body = json!({});
        forbid_tools("anthropic", &mut body);
        assert_eq!(body["tool_choice"]["type"], "none");
        forbid_tools("google", &mut body);
        assert_eq!(body["toolConfig"]["functionCallingConfig"]["mode"], "NONE");
        let mut body = json!({});
        forbid_tools("openai", &mut body);
        assert_eq!(body["tool_choice"], "none");
        let mut messages = vec![json!({"role": "tool", "content": "rows"})];
        note(&mut messages, "\n[l8db] x");
        assert_eq!(messages[0]["content"], "rows\n[l8db] x");
    }

    #[test]
    fn performance_collapse_over_a_long_agent_run() {
        let template = conversation(MAX_ROUNDS, 30_000);
        let mut samples = Vec::new();
        let mut kept = 0;
        for _ in 0..30 {
            let mut messages = template.clone();
            let started = Instant::now();
            super::super::byok::thin_tool_results(&mut messages, KEEP_ROUNDS, SOFT_CAP);
            collapse(&mut messages, 3, HARD_CAP, &Plan::default());
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
            kept = size(&messages);
            std::hint::black_box(&messages);
        }
        samples.sort_by(f64::total_cmp);
        let (median, p95) = (samples[15], samples[28]);
        println!(
            "harness compaction: {} rounds, {} KB history -> {} KB, median {median:.3} ms, p95 {p95:.3} ms",
            MAX_ROUNDS,
            size(&template) / 1000,
            kept / 1000
        );
        assert!(kept <= HARD_CAP, "{kept}");
        assert!(median < 25.0, "median {median} ms");
        assert!(p95 < 50.0, "p95 {p95} ms");
    }
}
