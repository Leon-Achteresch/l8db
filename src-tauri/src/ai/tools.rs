use crate::mcp::config::McpConfig;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const CORE: &[&str] = &[
    "connections",
    "search",
    "describe",
    "query",
    "execute",
    "visualize",
    "editor",
];

pub(super) struct Catalog {
    available: Vec<Value>,
    loaded: Vec<Value>,
}

impl Catalog {
    pub fn new(config: &McpConfig, attachments: bool, external: &[Value]) -> Self {
        let mut available: Vec<Value> = super::context::tool_definitions()
            .into_iter()
            .filter(|tool| match tool["name"].as_str().unwrap_or("") {
                "script" => false,
                "execute" => config
                    .connections
                    .iter()
                    .any(|entry| !entry.writes_blocked()),
                "import_file" => {
                    attachments
                        && config
                            .connections
                            .iter()
                            .any(|entry| !entry.writes_blocked() && entry.allow_ddl)
                }
                "health" => config
                    .connections
                    .iter()
                    .any(|entry| entry.kind.capabilities().health_advisor),
                _ => true,
            })
            .collect();
        available.extend_from_slice(external);
        let mut loaded: Vec<Value> = available
            .iter()
            .filter(|tool| CORE.contains(&tool["name"].as_str().unwrap_or("")))
            .cloned()
            .collect();
        loaded.push(json!({
            "name": "discover_tools",
            "description": "Find and load tools for dashboards, workflows, benchmarks, health checks, opening things in l8db, saving knowledge, importing attachments and external MCPs. Search with query or request exact names. Empty arguments list available names and brief descriptions. Loaded tools become callable in the next round; do not call them in this round.",
            "inputSchema": {"type": "object", "properties": {
                "query": {"type": "string", "description": "Tool name or words describing the task"},
                "names": {"type": "array", "items": {"type": "string"}, "maxItems": 8, "description": "Exact tool names to load"}
            }}
        }));
        Self { available, loaded }
    }

    pub fn tools(&self) -> &[Value] {
        &self.loaded
    }

    pub fn discover(&mut self, args: &Value) -> Value {
        let result = self.load(args);
        match result {
            Ok(text) => json!({"content": [{"type": "text", "text": text}], "isError": false}),
            Err(text) => json!({"content": [{"type": "text", "text": text}], "isError": true}),
        }
    }

    fn load(&mut self, args: &Value) -> Result<String, String> {
        if !args.is_object() {
            return Err("discover_tools arguments must be an object".into());
        }
        let mut selected = Vec::new();
        if let Some(names) = args.get("names") {
            let names = names
                .as_array()
                .filter(|names| !names.is_empty() && names.len() <= 8)
                .ok_or("names must contain one to eight tool names")?;
            for name in names {
                let name = name.as_str().ok_or("Tool names must be strings")?;
                let index = self
                    .available
                    .iter()
                    .position(|tool| tool["name"] == name)
                    .ok_or_else(|| format!("Tool '{name}' is unavailable; use an empty query to list available tools"))?;
                selected.push(index);
            }
        } else {
            let query = match args.get("query") {
                None => "",
                Some(query) => query.as_str().ok_or("query must be a string")?,
            };
            let query = query.trim().to_lowercase();
            if query.is_empty() {
                return Ok(self
                    .available
                    .iter()
                    .map(|tool| {
                        format!(
                            "{}: {}",
                            tool["name"].as_str().unwrap_or(""),
                            tool["description"]
                                .as_str()
                                .unwrap_or("")
                                .split(". ")
                                .next()
                                .unwrap_or("")
                                .chars()
                                .take(160)
                                .collect::<String>()
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n"));
            }
            let words: Vec<&str> = query.split_whitespace().collect();
            let mut matches: Vec<(usize, usize)> = self
                .available
                .iter()
                .enumerate()
                .filter_map(|(index, tool)| {
                    let name = tool["name"].as_str().unwrap_or("").to_lowercase();
                    let description = tool["description"].as_str().unwrap_or("").to_lowercase();
                    let score = if name == query {
                        1000
                    } else {
                        words
                            .iter()
                            .map(|word| {
                                usize::from(name.contains(*word)) * 10
                                    + usize::from(description.contains(*word))
                            })
                            .sum()
                    };
                    (score > 0).then_some((index, score))
                })
                .collect();
            matches.sort_by_key(|(index, score)| (std::cmp::Reverse(*score), *index));
            let count = if matches.first().is_some_and(|(_, score)| *score == 1000) {
                1
            } else {
                5
            };
            selected.extend(matches.into_iter().take(count).map(|(index, _)| index));
            if selected.is_empty() {
                return Ok("No matching tools. Use an empty query to list available tools.".into());
            }
        }
        let mut names = Vec::new();
        for index in selected {
            let tool = &self.available[index];
            if !self
                .loaded
                .iter()
                .any(|entry| entry["name"] == tool["name"])
            {
                self.loaded.push(tool.clone());
            }
            let name = tool["name"].as_str().unwrap_or("");
            if !names.contains(&name) {
                names.push(name);
            }
        }
        Ok(format!("Available next round: {}", names.join(", ")))
    }
}

#[derive(Default)]
pub(super) struct Failures {
    attempts: HashMap<String, usize>,
}

impl Failures {
    pub fn key(name: &str, args: &Value) -> String {
        format!("{name}:{}", ordered(args))
    }

    pub fn blocked(&self, key: &str) -> bool {
        self.attempts.get(key).copied().unwrap_or(0) >= 2
    }

    pub fn record(&mut self, key: String, result: &Value) {
        if result["isError"] == true {
            *self.attempts.entry(key).or_default() += 1;
        } else {
            self.attempts.remove(&key);
        }
    }
}

fn ordered(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_unstable();
            Value::Object(
                keys.into_iter()
                    .map(|key| (key.clone(), ordered(&object[key])))
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.iter().map(ordered).collect()),
        _ => value.clone(),
    }
}

pub(super) fn published(tools: &[Value]) -> HashSet<String> {
    tools
        .iter()
        .filter_map(|tool| tool["name"].as_str().map(str::to_string))
        .collect()
}

pub(super) fn model_output(result: &Value, max_chars: usize) -> String {
    let mut parts = Vec::new();
    if result["isError"] == true {
        parts.push("[tool error]".to_string());
    }
    for block in result["content"].as_array().into_iter().flatten() {
        match block["type"].as_str().unwrap_or("") {
            "text" => {
                if let Some(text) = block["text"].as_str() {
                    parts.push(text.to_string());
                }
            }
            "resource" => {
                let resource = &block["resource"];
                if let Some(text) = resource["text"].as_str() {
                    parts.push(text.to_string());
                } else {
                    parts.push(format!("[resource: {}]", resource["uri"]));
                }
            }
            "resource_link" => parts.push(format!("[resource: {}]", block["uri"])),
            "image" | "audio" => parts.push(format!(
                "[{} content is available in the tool result; omitted from text context]",
                block["type"].as_str().unwrap_or("binary")
            )),
            _ => {}
        }
    }
    if parts.len() == usize::from(result["isError"] == true) {
        if let Some(content) = result.get("structuredContent") {
            parts.push(content.to_string());
        } else {
            parts.push("[empty tool result]".into());
        }
    }
    crate::mcp::server::cap(parts.join("\n"), max_chars.min(20_000))
}
