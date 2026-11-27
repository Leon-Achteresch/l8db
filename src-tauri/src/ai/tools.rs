use crate::mcp::config::McpConfig;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const CORE: &[&str] = &[
    "search",
    "describe",
    "query",
    "code",
    "execute",
    "visualize",
    "chat_title",
];
const LISTED: usize = 600;

pub(crate) struct Catalog {
    available: Vec<Value>,
    loaded: Vec<Value>,
}

impl Catalog {
    pub fn new(config: &McpConfig, attachments: bool, external: &[Value]) -> Self {
        let published = crate::mcp::open::gated(super::context::published_tools(), config);
        let mut available: Vec<Value> = published
            .into_iter()
            .filter(|tool| match tool["name"].as_str().unwrap_or("") {
                "script" => false,
                "report_issue" => crate::issues::relay().is_ok(),
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
                "sandbox" => config.connections.iter().any(|entry| {
                    crate::mcp::sandbox::supported(entry.kind)
                        && !entry.writes_blocked()
                        && !entry.is_production()
                }),
                "drilldown" => config
                    .connections
                    .iter()
                    .any(|entry| crate::mcp::server::SQL_KINDS.contains(&entry.kind)),
                "health" => config
                    .connections
                    .iter()
                    .any(|entry| entry.kind.capabilities().health_advisor),
                _ => true,
            })
            .collect();
        available.extend_from_slice(external);
        let functions: Vec<String> = available
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .filter(|name| !CORE.contains(name))
            .map(str::to_string)
            .collect();
        announce(
            &mut available,
            &functions,
            "More l8db tools are functions here: `await tools.name(args)` resolves to the tool's text and throws ToolError; user approvals and write locks apply as for direct calls.",
        );
        let mut loaded: Vec<Value> = available
            .iter()
            .filter(|tool| CORE.contains(&tool["name"].as_str().unwrap_or("")))
            .cloned()
            .collect();
        loaded.push(super::harness::plan_definition());
        Self { available, loaded }
    }

    pub fn full(mut self) -> Self {
        self.loaded = self.available.clone();
        self
    }

    pub fn tools(&self) -> &[Value] {
        &self.loaded
    }

    pub fn direct(&self) -> Vec<Value> {
        self.loaded
            .iter()
            .filter(|tool| tool["name"] != "plan")
            .cloned()
            .collect()
    }

    pub fn available(&self) -> &[Value] {
        &self.available
    }

    pub fn callable(&self, name: &str) -> bool {
        name != "code" && self.available.iter().any(|tool| tool["name"] == name)
    }

    pub fn documents(name: &str, args: &Value) -> bool {
        name == "search" && args["in"] == "tools"
    }

    pub fn docs(&self, args: &Value) -> Value {
        let functions: Vec<&Value> = self
            .available
            .iter()
            .filter(|tool| tool["name"] != "code")
            .collect();
        docs(&functions, args)
    }
}

pub(crate) fn announce(tools: &mut [Value], functions: &[String], note: &str) {
    let mut listed = String::new();
    let mut hidden = 0;
    for name in functions {
        if listed.len() + name.len() > LISTED {
            hidden += 1;
        } else {
            if !listed.is_empty() {
                listed.push_str(", ");
            }
            listed.push_str(name);
        }
    }
    if hidden > 0 {
        listed.push_str(&format!(" and {hidden} more"));
    }
    for tool in tools {
        let extra = match tool["name"].as_str() {
            Some("search") => {
                tool["inputSchema"]["properties"]["in"]["enum"] =
                    json!(["names", "source", "tools"]);
                " in=tools finds l8db functions for code by words: signature, purpose, example; empty term lists all.".to_string()
            }
            Some("code") => format!(
                "\n{note} Look up the signature with search in=tools first. tools: {listed}."
            ),
            _ => continue,
        };
        tool["description"] = json!(format!(
            "{}{extra}",
            tool["description"].as_str().unwrap_or("")
        ));
    }
}

pub(crate) fn docs(functions: &[&Value], args: &Value) -> Value {
    let term = args["term"]
        .as_str()
        .or(args["query"].as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let limit = args["limit"].as_u64().unwrap_or(5).clamp(1, 10) as usize;
    let text = if term.is_empty() {
        functions
            .iter()
            .map(|tool| {
                format!(
                    "tools.{}: {}",
                    tool["name"].as_str().unwrap_or(""),
                    sentence(tool["description"].as_str().unwrap_or(""), 160)
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        let words: Vec<&str> = term
            .split(|c: char| c.is_whitespace() || matches!(c, '|' | ','))
            .map(|word| word.trim_start_matches("tools."))
            .filter(|word| !word.is_empty())
            .collect();
        let mut matches: Vec<(usize, usize)> = functions
            .iter()
            .enumerate()
            .filter_map(|(index, tool)| {
                let name = tool["name"].as_str().unwrap_or("").to_lowercase();
                let description = tool["description"].as_str().unwrap_or("").to_lowercase();
                let score = if words.contains(&name.as_str()) {
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
        let exact = matches.first().is_some_and(|(_, score)| *score == 1000);
        if exact {
            matches.retain(|(_, score)| *score == 1000);
        }
        let shown = if exact { 10 } else { limit };
        if matches.is_empty() {
            "No matching functions. search in=tools with an empty term lists all.".to_string()
        } else {
            let more = matches.len().saturating_sub(shown);
            let mut text = matches
                .into_iter()
                .take(shown)
                .map(|(index, _)| signature(functions[index]))
                .collect::<Vec<_>>()
                .join("\n\n");
            if more > 0 {
                text.push_str(&format!(
                    "\n\n[{more} more matches; narrow the term or name the functions]"
                ));
            }
            text
        }
    };
    json!({"content": [{"type": "text", "text": text}], "isError": false})
}

const SELF_GATED: &[&str] = &[
    "execute",
    "import_file",
    "report_issue",
    "knowledge",
    "dashboard",
    "workflow",
    "rules",
    "sandbox",
];

const DECLINES: usize = 3;

pub(super) struct Host<'a> {
    pub catalog: &'a Catalog,
    pub external: &'a tokio::sync::Mutex<super::integrations::External>,
    pub config: &'a McpConfig,
    pub run: &'a super::runtime::Run,
    cli: bool,
    declined: HashMap<String, Vec<String>>,
}

impl<'a> Host<'a> {
    pub fn new(
        catalog: &'a Catalog,
        external: &'a tokio::sync::Mutex<super::integrations::External>,
        config: &'a McpConfig,
        run: &'a super::runtime::Run,
    ) -> Self {
        Self {
            catalog,
            external,
            config,
            run,
            cli: false,
            declined: HashMap::new(),
        }
    }

    pub fn cli(mut self) -> Self {
        self.cli = true;
        self
    }

    async fn gate(&self, name: &str, args: &Value) -> Result<(), String> {
        if !self.cli || name.starts_with("ext_") {
            return Ok(());
        }
        let reads = self
            .catalog
            .available()
            .iter()
            .any(|tool| tool["name"] == name && tool["annotations"]["readOnlyHint"] == true);
        if self.run.plan_only {
            if super::cli::PLAN_READS.contains(&name) {
                return Ok(());
            }
            if !reads || SELF_GATED.contains(&name) {
                return Err(
                    "Im Plan-Modus sind aus code nur lesende Datenbank-Werkzeuge erreichbar."
                        .into(),
                );
            }
        } else if reads || SELF_GATED.contains(&name) {
            return Ok(());
        }
        match self
            .run
            .approve_tool(true, &format!("Tool aus code: {name}"), args.clone())
            .await
        {
            Ok(true) => Ok(()),
            _ => Err("Tool-Aufruf abgelehnt".into()),
        }
    }
}

impl crate::mcp::code::ToolHost for Host<'_> {
    fn names(&self) -> Vec<String> {
        self.catalog
            .available()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .filter(|name| !matches!(*name, "code" | "then"))
            .map(str::to_string)
            .collect()
    }

    fn call<'a>(
        &'a mut self,
        server: &'a mut crate::mcp::server::Server,
        name: &'a str,
        args: Value,
    ) -> futures_util::future::BoxFuture<'a, Result<String, String>> {
        Box::pin(async move {
            if !self.catalog.callable(name) {
                return Err(format!(
                    "tools.{name} does not exist. search in=tools lists the functions."
                ));
            }
            let args = crate::mcp::server::normalize_args(self.catalog.available(), name, args);
            let key = args.to_string();
            if let Some(seen) = self.declined.get(name) {
                if seen.len() >= DECLINES {
                    return Err(format!(
                        "The user already declined tools.{name} {DECLINES} times in this code run; do not call it again here."
                    ));
                }
                if seen.contains(&key) {
                    return Err(format!(
                        "The user already declined tools.{name} with these arguments in this code run; do not repeat it."
                    ));
                }
            }
            let flag = std::cell::Cell::new(false);
            let (outcome, declined) = super::runtime::DECLINED
                .scope(flag, async {
                    let outcome = self.dispatch(server, name, args).await;
                    (outcome, super::runtime::DECLINED.with(std::cell::Cell::get))
                })
                .await;
            if declined {
                self.declined.entry(name.to_string()).or_default().push(key);
            }
            outcome
        })
    }
}

impl Host<'_> {
    async fn dispatch(
        &mut self,
        server: &mut crate::mcp::server::Server,
        name: &str,
        args: Value,
    ) -> Result<String, String> {
        self.gate(name, &args).await?;
        let result = if name.starts_with("ext_") {
            if self.run.auto(true)
                && !self
                    .run
                    .approve(&format!("Externes Tool aus code: {name}"), args.clone())
                    .await
                    .unwrap_or(false)
            {
                return Err("Tool-Aufruf abgelehnt".into());
            }
            self.external.lock().await.call(name, args, self.run).await
        } else if Catalog::documents(name, &args) {
            self.catalog.docs(&args)
        } else {
            super::context::call_in(
                &mut super::context::Access::Held(server),
                self.config,
                self.run,
                name,
                args,
            )
            .await
        };
        let text = model_output(&result, self.config.max_chars);
        if result["isError"] != true {
            return Ok(text);
        }
        let text = text.trim_start_matches("[tool error]").trim_start();
        Err(
            if super::runtime::DECLINED.try_with(std::cell::Cell::get) == Ok(true) {
                text.to_string()
            } else {
                crate::mcp::code::hinted(text, name)
            },
        )
    }
}

fn sentence(text: &str, max: usize) -> String {
    text.split(". ")
        .next()
        .unwrap_or("")
        .chars()
        .take(max)
        .collect()
}

fn ts(schema: &Value, depth: usize) -> String {
    if let Some(values) = schema["enum"]
        .as_array()
        .filter(|values| !values.is_empty())
    {
        return values
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("|");
    }
    let kinds: Vec<&str> = match &schema["type"] {
        Value::String(kind) => vec![kind.as_str()],
        Value::Array(kinds) => kinds.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    let rendered: Vec<String> = kinds
        .iter()
        .map(|kind| match *kind {
            "integer" | "number" => "number".to_string(),
            "string" | "boolean" | "null" => kind.to_string(),
            "array" => {
                let item = ts(&schema["items"], depth + 1);
                if item.contains('|') {
                    format!("({item})[]")
                } else {
                    format!("{item}[]")
                }
            }
            "object" => match schema["properties"].as_object() {
                Some(properties) if !properties.is_empty() && depth < 3 => {
                    let required: Vec<&str> = schema["required"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect();
                    let fields: Vec<String> = properties
                        .iter()
                        .map(|(key, property)| {
                            let note = match property["description"].as_str() {
                                Some(text) if !text.is_empty() => {
                                    format!(" /*{}*/", sentence(text, 100).replace("*/", ""))
                                }
                                _ => String::new(),
                            };
                            format!(
                                "{key}{}: {}{note}",
                                if required.contains(&key.as_str()) {
                                    ""
                                } else {
                                    "?"
                                },
                                ts(property, depth + 1)
                            )
                        })
                        .collect();
                    format!("{{{}}}", fields.join("; "))
                }
                _ => "object".to_string(),
            },
            _ => "unknown".to_string(),
        })
        .collect();
    if rendered.is_empty() {
        "unknown".into()
    } else {
        rendered.join("|")
    }
}

fn sample(schema: &Value) -> Value {
    if let Some(first) = schema["enum"].as_array().and_then(|values| values.first()) {
        return first.clone();
    }
    let kind = match &schema["type"] {
        Value::String(kind) => kind.as_str(),
        Value::Array(kinds) => kinds.first().and_then(Value::as_str).unwrap_or(""),
        _ => "",
    };
    match kind {
        "integer" | "number" => json!(1),
        "boolean" => json!(true),
        "array" => json!([]),
        "object" => {
            let mut out = serde_json::Map::new();
            let action = schema["properties"].get("action").map(|_| "action");
            for key in action.into_iter().chain(
                schema["required"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str),
            ) {
                out.insert(key.to_string(), sample(&schema["properties"][key]));
            }
            Value::Object(out)
        }
        _ => json!("…"),
    }
}

fn signature(tool: &Value) -> String {
    let name = tool["name"].as_str().unwrap_or("");
    let schema = &tool["inputSchema"];
    format!(
        "tools.{name}(args: {}): Promise<string>\n{}\ne.g. await tools.{name}({})",
        ts(schema, 0),
        tool["description"].as_str().unwrap_or(""),
        sample(schema)
    )
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
