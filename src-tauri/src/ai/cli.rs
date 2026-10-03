use super::{
    bridge::Bridge,
    rpc::Rpc,
    runtime::Run,
    types::{Profile, RunRequest},
};
use serde_json::{json, Value};
use std::time::Duration;

fn optional(text: &str) -> Value {
    if text.trim().is_empty() {
        Value::Null
    } else {
        json!(text)
    }
}

fn bypass_permissions(id: &str, value: &Value) -> bool {
    let text = value.as_str().unwrap_or("").to_ascii_lowercase();
    let mode = text.rsplit(['#', '/']).next().unwrap_or(&text);
    let normalized = mode.replace(['-', '_', ' '], "");
    let id = id.to_ascii_lowercase().replace(['-', '_'], "");
    ((id.contains("allowall") || id.contains("bypass"))
        && (value == &json!(true) || ["true", "on", "enabled"].contains(&text.as_str())))
        || [
            "bypasspermissions",
            "yolo",
            "dangerfullaccess",
            "autopilot",
            "autoapprove",
            "allowall",
        ]
        .contains(&normalized.as_str())
        || (normalized == "auto"
            && (id.contains("permission")
                || id.contains("approval")
                || (id.contains("mode")
                    && !["model", "reasoning", "thinking"]
                        .iter()
                        .any(|role| id.contains(role)))))
        || (id.contains("approval") && ["never", "none"].contains(&normalized.as_str()))
}

fn codex_approval(profile: &Profile) -> Value {
    if plan_mode(&profile.mode) {
        json!({"granular": {"sandbox_approval": false, "rules": false, "mcp_elicitations": true, "request_permissions": false, "skill_approval": true}})
    } else {
        json!("untrusted")
    }
}

fn plan_mode(mode: &str) -> bool {
    mode.rsplit(['#', '/']).next() == Some("plan")
}

fn acp_plan_read(tool: &Value) -> bool {
    match tool["kind"].as_str() {
        Some("read" | "search") => return true,
        Some("other") | None => {}
        Some(_) => return false,
    }
    let reads = ["connections", "search", "describe", "query"];
    let input = &tool["rawInput"];
    if input["serverName"] == "l8db_ai"
        && input["toolName"]
            .as_str()
            .is_some_and(|name| reads.contains(&name))
    {
        return true;
    }
    tool["title"].as_str().is_some_and(|title| {
        ["l8db_ai-", "l8db_ai_", "mcp__l8db_ai__"]
            .iter()
            .any(|prefix| {
                title
                    .strip_prefix(prefix)
                    .is_some_and(|name| reads.contains(&name))
            })
    })
}

fn acp_mcp(tool: &Value) -> bool {
    tool["rawInput"]["serverName"].is_string()
        || tool["title"].as_str().is_some_and(|title| {
            ["mcp__", "l8db_ai"]
                .iter()
                .any(|prefix| title.starts_with(prefix))
        })
}

fn inherited_permission_changes(session: &Value, requested: &str) -> Result<Vec<Value>, String> {
    let mut changes = Vec::new();
    let mut changed_mode = false;
    let safe_modes = [
        requested,
        "plan",
        "interactive",
        "manual",
        "default",
        "ask",
        "normal",
    ];
    for option in session["configOptions"].as_array().into_iter().flatten() {
        let id = option["id"].as_str().unwrap_or("");
        let permission_id = if option["category"] == "mode" {
            "mode"
        } else {
            id
        };
        if !bypass_permissions(permission_id, &option["currentValue"]) {
            continue;
        }
        let safe = if option["category"] == "mode" || id == "mode" {
            changed_mode = true;
            safe_modes.iter().copied().filter(|mode| !mode.is_empty() && !bypass_permissions(permission_id, &json!(mode)))
                .map(|mode| json!(mode)).find(|value| option_contains(&option["options"], value))
        } else {
            [json!(false), json!("false"), json!("off"), json!("disabled"), json!("untrusted"), json!("on-request")]
                .into_iter().find(|value| option_contains(&option["options"], value))
        }.ok_or("Die native CLI umgeht Freigaben. Einen sicheren Modus in der CLI konfigurieren und die Sitzung erneut öffnen.")?;
        changes.push(json!({"method": "session/set_config_option", "params": {"configId": id, "value": safe}}));
    }
    let current = &session["modes"]["currentModeId"];
    if !changed_mode && bypass_permissions("mode", current) {
        let mode = safe_modes.iter().copied().filter(|mode| !mode.is_empty() && !bypass_permissions("mode", &json!(mode)))
            .find(|mode| session["modes"]["availableModes"].as_array().into_iter().flatten().any(|option| option["id"].as_str() == Some(*mode)))
            .ok_or("Die native CLI umgeht Freigaben. Einen sicheren Modus in der CLI konfigurieren und die Sitzung erneut öffnen.")?;
        changes.push(json!({"method": "session/set_mode", "params": {"modeId": mode}}));
    }
    Ok(changes)
}

pub(super) fn launch(profile: &Profile, cwd: &str) -> Result<tokio::process::Command, String> {
    let mut command = super::command(profile)?;
    command.current_dir(cwd);
    match profile.provider.as_str() {
        "codex" => {
            command.arg("app-server");
        }
        "claude" => {
            command.args([
                "--print",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--permission-prompt-tool",
                "stdio",
            ]);
            command.args([
                "--permission-mode",
                if plan_mode(&profile.mode) {
                    "plan"
                } else {
                    "default"
                },
            ]);
        }
        "opencode" => {
            command.arg("acp");
        }
        "gemini-cli" => {
            command.arg("--acp");
        }
        "copilot" => {
            command.args(["--acp", "--stdio"]);
            if !profile.model.is_empty() {
                command.arg("--model").arg(&profile.model);
            }
            if !profile.effort.is_empty() {
                command.arg(format!("--effort={}", profile.effort));
            }
        }
        _ => return Err("Unbekannte CLI".into()),
    }
    Ok(command)
}

async fn initialize(rpc: &Rpc, codex: bool) -> Result<Value, String> {
    let result = rpc.request("initialize", if codex { json!({"clientInfo": {"name": "l8db", "title": "l8db AI", "version": env!("CARGO_PKG_VERSION")}, "capabilities": {"experimentalApi": true}}) } else { json!({"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": false, "writeTextFile": false}, "terminal": false}, "clientInfo": {"name": "l8db", "version": env!("CARGO_PKG_VERSION")}}) }).await?;
    if codex {
        rpc.send(json!({"method": "initialized"})).await?;
    }
    Ok(result)
}

async fn claude_init(rpc: &mut Rpc) -> Result<Value, String> {
    rpc.send(json!({"type": "control_request", "request_id": "l8db-init", "request": {"subtype": "initialize"}})).await?;
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let event = rpc
                .events
                .recv()
                .await
                .ok_or("Claude Code wurde beendet. CLI-Version und Anmeldung prüfen.")?;
            if event["type"] == "control_response" && event["response"]["request_id"] == "l8db-init"
            {
                if event["response"]["subtype"] == "error" {
                    return Err("Claude-Code-Initialisierung abgelehnt".into());
                }
                return Ok(event["response"]["response"].clone());
            }
        }
    })
    .await
    .map_err(|_| "Claude Code antwortet nicht")?
}

pub async fn models(profile: &Profile, cwd: Option<&str>) -> Result<Value, String> {
    let cwd = if let Some(cwd) = cwd.filter(|cwd| !cwd.trim().is_empty()) {
        let path = std::path::PathBuf::from(cwd);
        if !path.is_absolute() || !path.is_dir() {
            return Err("CLI-Arbeitsordner ist nicht verfügbar".into());
        }
        path
    } else {
        let path = crate::mcp::config::config_dir().join("ai-workspace");
        std::fs::create_dir_all(&path).map_err(|_| "KI-Arbeitsordner fehlt")?;
        path
    };
    let mut command = launch(profile, &cwd.to_string_lossy())?;
    let mut rpc = Rpc::spawn(&mut command)?;
    match profile.provider.as_str() {
        "codex" => {
            initialize(&rpc, true).await?;
            let result = rpc.request("model/list", json!({"limit": 100})).await?;
            Ok(
                json!({"models": result["data"].as_array().into_iter().flatten().map(|model| json!({"id": model["model"], "name": model["displayName"], "efforts": model["supportedReasoningEfforts"]})).collect::<Vec<_>>()}),
            )
        }
        "claude" => {
            let result = claude_init(&mut rpc).await?;
            Ok(
                json!({"models": result["models"].as_array().into_iter().flatten().map(|model| json!({"id": model["value"], "name": model["displayName"]})).collect::<Vec<_>>(), "commands": result["commands"]}),
            )
        }
        _ => {
            let initialized = initialize(&rpc, false).await?;
            let result = probe_request(
                &mut rpc,
                "session/new",
                json!({"cwd": cwd, "mcpServers": []}),
            )
            .await?;
            Ok(
                json!({"models": session_models(&result), "modes": session_modes(&result), "configOptions": result["configOptions"], "customModel": profile.provider == "copilot" && session_models(&result).is_empty(), "capabilities": initialized["agentCapabilities"]}),
            )
        }
    }
}

async fn probe_request(rpc: &mut Rpc, method: &str, params: Value) -> Result<Value, String> {
    let mut response = rpc.begin(method, params).await?;
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            tokio::select! {
                result = &mut response => return result.map_err(|_| "CLI-Verbindung geschlossen")?,
                event = rpc.events.recv() => {
                    let event = event.ok_or("CLI-Verbindung beendet")?;
                    if event.get("id").is_some() && event["method"].is_string() {
                        rpc.send(json!({"jsonrpc":"2.0", "id":event["id"], "error":{"code":-32601, "message":"Model discovery does not allow tool execution"}})).await?;
                    }
                }
            }
        }
    }).await.map_err(|_| "CLI-Modellliste antwortet nicht (30 Sekunden)")?
}

fn option_contains(options: &Value, value: &Value) -> bool {
    options.as_array().is_some_and(|options| {
        options.iter().any(|option| {
            option.get("value") == Some(value) || option_contains(&option["options"], value)
        })
    })
}

fn session_models(session: &Value) -> Vec<Value> {
    let models = session["models"]["availableModels"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|model| json!({"id": model["modelId"], "name": model["name"]}))
        .collect::<Vec<_>>();
    if !models.is_empty() {
        return models;
    }
    fn collect(options: &Value, models: &mut Vec<Value>) {
        for option in options.as_array().into_iter().flatten() {
            if option["value"].is_string() {
                models.push(json!({"id": option["value"], "name": option["name"]}));
            }
            collect(&option["options"], models);
        }
    }
    let mut models = Vec::new();
    for option in session["configOptions"].as_array().into_iter().flatten() {
        if option["category"] == "model" || option["id"] == "model" {
            collect(&option["options"], &mut models);
        }
    }
    models
}

fn session_modes(session: &Value) -> Value {
    if session["modes"].is_object() {
        return session["modes"].clone();
    }
    if let Some(option) = session["configOptions"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|option| option["category"] == "mode" || option["id"] == "mode")
    {
        return json!({"currentModeId": option["currentValue"], "availableModes": option["options"].as_array().into_iter().flatten().filter(|option| option["value"].is_string()).map(|option| json!({"id": option["value"], "name": option["name"], "description": option["description"]})).collect::<Vec<_>>()});
    }
    Value::Null
}

pub(super) fn delta(event: &Value) -> Option<String> {
    match event["method"].as_str().unwrap_or("") {
        "item/agentMessage/delta" => event["params"]["delta"].as_str().map(str::to_string),
        "session/update" if event["params"]["update"]["sessionUpdate"] == "agent_message_chunk" => {
            event["params"]["update"]["content"]["text"]
                .as_str()
                .map(str::to_string)
        }
        _ if event["type"] == "stream_event" && event["event"]["delta"]["type"] == "text_delta" => {
            event["event"]["delta"]["text"].as_str().map(str::to_string)
        }
        _ => None,
    }
}

async fn native_event(rpc: &Rpc, event: &Value, run: &Run) -> Result<(), String> {
    if let Some(text) = delta(event) {
        run.emit("text", json!({"delta": text}));
    }
    let method = event["method"].as_str().unwrap_or("");
    let params = &event["params"];
    if method == "session/update" {
        let update = &params["update"];
        match update["sessionUpdate"].as_str().unwrap_or("") {
            "tool_call" | "tool_call_update" => {
                let mut tool = json!({"id": update["toolCallId"]});
                for (source, target) in [
                    ("title", "name"),
                    ("status", "status"),
                    ("rawInput", "arguments"),
                    ("kind", "kind"),
                    ("locations", "locations"),
                ] {
                    if let Some(value) = update.get(source) {
                        tool[target] = value.clone();
                    }
                }
                if update.get("content").is_some() || update.get("rawOutput").is_some() {
                    tool["result"] =
                        json!({"content": update["content"], "output": update["rawOutput"]});
                }
                run.emit("tool", tool);
            }
            "agent_thought_chunk" => {
                run.emit("reasoning", json!({"delta": update["content"]["text"]}))
            }
            "agent_message_chunk" if update["content"]["type"] != "text" => {
                run.emit("artifact", json!({"content": update["content"]}))
            }
            "usage_update" => run.emit("usage", json!({"context": update})),
            "available_commands_update"
            | "config_option_update"
            | "current_mode_update"
            | "plan" => run.emit("metadata", update.clone()),
            _ => {}
        }
    }
    if method == "turn/plan/updated" {
        run.emit(
            "metadata",
            json!({"plan": params["plan"], "planExplanation": params["explanation"]}),
        );
    }
    if method == "turn/diff/updated" {
        run.emit("metadata", json!({"diff": params["diff"]}));
    }
    if method == "item/started" || method == "item/completed" {
        let item = &params["item"];
        if method == "item/completed" && item["type"] == "agentMessage" {
            if let Some(entries) = item["memoryCitation"]["entries"].as_array() {
                run.emit("metadata", json!({"citations": entries}));
            }
        }
        if item["type"] != "agentMessage"
            && item["type"] != "userMessage"
            && item["type"] != "reasoning"
        {
            run.emit("tool", json!({"id": item["id"], "name": item["type"], "arguments": item["arguments"], "result": item, "status": if method == "item/started" { "running" } else if item["status"] == "failed" || item["status"] == "declined" { "error" } else { "completed" }}));
        }
    }
    if method == "item/fileChange/patchUpdated" {
        run.emit("tool", json!({"id": params["itemId"], "name": "fileChange", "status": "running", "result": {"type": "fileChange", "changes": params["changes"]}}));
    }
    if method.contains("reasoning") && method.ends_with("/delta") {
        run.emit("reasoning", json!({"delta": params["delta"]}));
    }
    if method == "thread/tokenUsage/updated" || method == "account/rateLimits/updated" {
        run.emit("usage", params.clone());
    }
    if event.get("id").is_some() && !method.is_empty() {
        let result = match method {
            "session/request_permission" => {
                let allowed = (!run.plan_only || acp_plan_read(&params["toolCall"]))
                    && run
                        .approve_tool(
                            acp_mcp(&params["toolCall"]),
                            "CLI-Tool freigeben",
                            params["toolCall"].clone(),
                        )
                        .await?;
                let option = params["options"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|option| {
                        option["kind"] == if allowed { "allow_once" } else { "reject_once" }
                    });
                option.map(|option| json!({"outcome": {"outcome": "selected", "optionId": option["optionId"]}})).unwrap_or(json!({"outcome": {"outcome": "cancelled"}}))
            }
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                let allowed = !run.plan_only
                    && run
                        .approve_tool(false, "CLI-Aktion freigeben", params.clone())
                        .await?;
                json!({"decision": if allowed { "accept" } else { "decline" }})
            }
            "execCommandApproval" | "applyPatchApproval" => {
                let allowed = !run.plan_only
                    && run
                        .approve_tool(false, "CLI-Aktion freigeben", params.clone())
                        .await?;
                json!({"decision": if allowed { "approved" } else { "abort" }})
            }
            "item/permissions/requestApproval" => {
                let allowed = !run.plan_only
                    && run
                        .approve_tool(false, "CLI-Berechtigung freigeben", params.clone())
                        .await?;
                json!({"permissions": if allowed { params["permissions"].clone() } else { json!({}) }, "scope": "turn"})
            }
            "item/tool/requestUserInput" => {
                let answer = run.input("CLI-Rückfrage", params.clone()).await?;
                if answer["answers"].is_object() {
                    answer
                } else {
                    json!({"answers": {}})
                }
            }
            "mcpServer/elicitation/request"
                if params["_meta"]["codex_approval_kind"] == "mcp_tool_call" && run.auto(true) =>
            {
                json!({"action": "accept", "content": {}})
            }
            "mcpServer/elicitation/request" => {
                let answer = run.input("MCP-Rückfrage", params.clone()).await?;
                if answer.is_object() {
                    answer
                } else {
                    json!({"action": "decline", "content": null})
                }
            }
            _ => {
                rpc.send(json!({"jsonrpc": "2.0", "id": event["id"], "error": {"code": -32601, "message": "Unsupported client capability"}})).await?;
                return Ok(());
            }
        };
        rpc.reply(event["id"].clone(), result).await?;
    }
    Ok(())
}

async fn native_request(
    rpc: &mut Rpc,
    method: &str,
    params: Value,
    run: &Run,
    replay: bool,
) -> Result<Value, String> {
    let mut response = rpc.begin(method, params).await?;
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            tokio::select! {
                biased;
                event = rpc.events.recv() => {
                    let Some(event) = event else { return response.await.map_err(|_| "CLI-Verbindung geschlossen")?; };
                    let metadata = event["method"] == "session/update" && matches!(event["params"]["update"]["sessionUpdate"].as_str(), Some("available_commands_update" | "config_option_update" | "current_mode_update"));
                    if !replay || event.get("id").is_some() || metadata { native_event(rpc, &event, run).await?; }
                }
                result = &mut response => return result.map_err(|_| "CLI-Verbindung geschlossen")?,
            }
        }
    }).await.map_err(|_| "CLI-Sitzung antwortet nicht (60 Sekunden)")?
}

fn conversation(request: &RunRequest, native_resume: bool) -> String {
    if native_resume || request.messages.len() <= 1 {
        request
            .messages
            .last()
            .map(|message| message.text.clone())
            .unwrap_or_default()
    } else {
        request
            .messages
            .iter()
            .map(|message| format!("{}: {}", message.role, message.text))
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

async fn claude_fresh_prompt(profile: &Profile) -> bool {
    let Ok(mut command) = super::command(profile) else {
        return false;
    };
    command.arg("--help").kill_on_drop(true);
    tokio::time::timeout(Duration::from_secs(8), command.output())
        .await
        .ok()
        .and_then(Result::ok)
        .is_some_and(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).contains("--system-prompt-snapshot")
        })
}

fn prompt(request: &RunRequest, instructions: &str, native_resume: bool) -> String {
    let text = if native_resume {
        request
            .messages
            .last()
            .map(|message| message.text.clone())
            .unwrap_or_default()
    } else {
        request
            .messages
            .iter()
            .map(|message| format!("{}: {}", message.role, message.text))
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    format!("Current l8db context and selected skills for this turn:\n{instructions}\n\nUser conversation:\n{text}")
}

async fn codex(
    request: &RunRequest,
    instructions: &str,
    bridge: &Bridge,
    run: &Run,
) -> Result<(), String> {
    let mut command = launch(&request.profile, &request.cwd)?;
    let mcp = bridge.mcp()?;
    command.args([
        "-c",
        &format!("mcp_servers.l8db_ai.command={}", mcp["command"]),
        "-c",
        &format!("mcp_servers.l8db_ai.args={}", mcp["args"]),
    ]);
    let mut rpc = Rpc::spawn(&mut command)?;
    initialize(&rpc, true).await?;
    let approval = codex_approval(&request.profile);
    let mut parameters = json!({"cwd": request.cwd, "model": optional(&request.profile.model), "developerInstructions": instructions, "approvalPolicy": approval, "sandbox": "read-only", "config": {"mcp_servers.l8db_ai.command": mcp["command"], "mcp_servers.l8db_ai.args": mcp["args"]}});
    if let Some(session) = &request.session_id {
        parameters["threadId"] = json!(session);
        parameters["excludeTurns"] = json!(true);
    }
    let session = native_request(
        &mut rpc,
        if request.session_id.is_some() {
            "thread/resume"
        } else {
            "thread/start"
        },
        parameters,
        run,
        true,
    )
    .await?;
    let id = session["thread"]["id"]
        .as_str()
        .ok_or("Codex-Sitzungs-ID fehlt")?;
    run.emit("session", json!({"sessionId": id}));
    run.emit("metadata", json!({"model": session["model"]}));
    let mut parameters = json!({"threadId": id, "input": [{"type": "text", "text": conversation(request, request.session_id.is_some())}], "model": optional(&request.profile.model), "effort": optional(&request.profile.effort), "approvalPolicy": approval, "sandboxPolicy": {"type": "readOnly", "networkAccess": false}});
    if plan_mode(&request.profile.mode) {
        parameters["input"][0]["text"] = json!(format!(
            "Plan only; do not execute writes or modify files.\n{}",
            parameters["input"][0]["text"].as_str().unwrap_or("")
        ));
    }
    rpc.request("turn/start", parameters).await?;
    loop {
        let event = rpc.events.recv().await.ok_or("Codex-Verbindung beendet")?;
        native_event(&rpc, &event, run).await?;
        if event["method"] == "turn/completed" {
            if event["params"]["turn"]["status"] == "failed" {
                return Err(
                    "Codex konnte die Anfrage nicht abschließen. Anmeldung und Kontingent prüfen."
                        .into(),
                );
            }
            return Ok(());
        }
        if event["method"] == "error" && event["params"]["willRetry"] != true {
            return Err(
                "Codex meldet einen Fehler. Modell, Anmeldung und Kontingent prüfen.".into(),
            );
        }
    }
}

fn acp_completion(result: Value, run: &Run) -> Result<(), String> {
    if result["usage"].is_object() {
        run.emit("usage", json!({"usage": result["usage"]}));
    }
    run.emit("metadata", json!({"stopReason": result["stopReason"]}));
    match result["stopReason"].as_str() {
        Some("refusal") => Err("Die CLI hat die Anfrage abgelehnt".into()),
        Some("cancelled") => Err("Die native CLI hat die Anfrage unterbrochen".into()),
        Some(_) => Ok(()),
        None => Err("CLI-Anfrage wurde ohne gültigen Abschluss beendet".into()),
    }
}

fn copilot_bridge_config(mcp: &Value) -> Value {
    json!({"mcpServers": {"l8db_ai": {"type": "local", "command": mcp["command"], "args": mcp["args"], "env": {}, "tools": ["*"], "timeout": 660000}}})
}

async fn acp(
    request: &RunRequest,
    instructions: &str,
    bridge: &Bridge,
    run: &Run,
) -> Result<(), String> {
    let mut command = launch(&request.profile, &request.cwd)?;
    let mut mcp = bridge.mcp()?;
    if request.profile.provider == "copilot" {
        command
            .arg("--additional-mcp-config")
            .arg(copilot_bridge_config(&mcp).to_string());
    }
    let mut rpc = Rpc::spawn(&mut command)?;
    let capabilities = initialize(&rpc, false).await?;
    run.emit("metadata", json!({"capabilities": capabilities["agentCapabilities"], "authMethods": capabilities["authMethods"]}));
    mcp["name"] = json!("l8db_ai");
    mcp["env"] = json!([]);
    let resume_method =
        if capabilities["agentCapabilities"]["sessionCapabilities"]["resume"].is_object() {
            Some("session/resume")
        } else if capabilities["agentCapabilities"]["loadSession"] == true {
            Some("session/load")
        } else {
            None
        };
    let resume = request.session_id.is_some() && resume_method.is_some();
    let servers = if request.profile.provider == "copilot" {
        vec![]
    } else {
        vec![mcp]
    };
    let mut parameters = json!({"cwd": request.cwd, "mcpServers": servers});
    if resume {
        parameters["sessionId"] = json!(request.session_id);
    }
    let session = native_request(
        &mut rpc,
        if resume {
            resume_method.unwrap_or("session/load")
        } else {
            "session/new"
        },
        parameters,
        run,
        true,
    )
    .await?;
    let id = if resume {
        request.session_id.as_deref().unwrap_or("")
    } else {
        session["sessionId"]
            .as_str()
            .ok_or("CLI-Sitzungs-ID fehlt")?
    };
    run.emit("session", json!({"sessionId": id}));
    run.emit("metadata", session.clone());
    let mut permission_result = Value::Null;
    for change in inherited_permission_changes(&session, &request.profile.mode)? {
        let mut parameters = change["params"].clone();
        parameters["sessionId"] = json!(id);
        permission_result = native_request(
            &mut rpc,
            change["method"].as_str().unwrap_or(""),
            parameters,
            run,
            true,
        )
        .await?;
    }
    if !inherited_permission_changes(&permission_result, "")?.is_empty() {
        return Err("Die native CLI hat den sicheren Berechtigungsmodus nicht übernommen".into());
    }
    if !(request.profile.model.is_empty()
        || request.profile.provider == "copilot" && session_models(&session).is_empty())
    {
        let model_option = session["configOptions"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|option| {
                (option["category"] == "model" || option["id"] == "model")
                    && option_contains(&option["options"], &json!(request.profile.model))
            });
        if let Some(option) = model_option {
            native_request(
                &mut rpc,
                "session/set_config_option",
                json!({"sessionId": id, "configId": option["id"], "value": request.profile.model}),
                run,
                true,
            )
            .await?;
        } else if session_models(&session)
            .iter()
            .any(|model| model["id"] == request.profile.model)
        {
            native_request(
                &mut rpc,
                "session/set_model",
                json!({"sessionId": id, "modelId": request.profile.model}),
                run,
                true,
            )
            .await?;
        } else {
            return Err(
                "Modell ist in der nativen CLI-Sitzung nicht verfügbar. Modellliste aktualisieren."
                    .into(),
            );
        }
    }
    if bypass_permissions("mode", &json!(request.profile.mode)) {
        return Err("Berechtigungsumgehung wird im KI-Arbeitsbereich nicht unterstützt".into());
    }
    if !request.profile.mode.is_empty() && request.profile.mode != "default" {
        if let Some(option) = session["configOptions"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|option| {
                (option["category"] == "mode" || option["id"] == "mode")
                    && option_contains(&option["options"], &json!(request.profile.mode))
            })
        {
            native_request(
                &mut rpc,
                "session/set_config_option",
                json!({"sessionId": id, "configId": option["id"], "value": request.profile.mode}),
                run,
                true,
            )
            .await?;
        } else if session["modes"]["availableModes"]
            .as_array()
            .is_some_and(|modes| modes.iter().any(|mode| mode["id"] == request.profile.mode))
        {
            native_request(
                &mut rpc,
                "session/set_mode",
                json!({"sessionId": id, "modeId": request.profile.mode}),
                run,
                true,
            )
            .await?;
        } else {
            return Err("Der gewählte Modus wird von dieser CLI nicht unterstützt".into());
        }
    }
    for (config_id, value) in &request.profile.config {
        let option = session["configOptions"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|option| option["id"] == *config_id)
            .ok_or(
                "CLI-Konfigurationsoption ist nicht mehr verfügbar. Modellliste aktualisieren.",
            )?;
        if !option_contains(&option["options"], value) {
            return Err("CLI-Konfigurationswert ist nicht verfügbar".into());
        }
        let permission_id = if option["category"] == "mode" {
            "mode"
        } else {
            config_id
        };
        if bypass_permissions(permission_id, value) {
            return Err("Berechtigungsumgehung wird im KI-Arbeitsbereich nicht unterstützt".into());
        }
        native_request(
            &mut rpc,
            "session/set_config_option",
            json!({"sessionId": id, "configId": config_id, "value": value}),
            run,
            true,
        )
        .await?;
    }
    let user = conversation(request, resume);
    let mut content = vec![json!({"type":"text", "text":user})];
    if !user.trim_start().starts_with('/') {
        content.push(json!({"type":"text", "text":format!("Current l8db context and selected skills for this turn:\n{instructions}")}));
    }
    let mut result = rpc
        .begin(
            "session/prompt",
            json!({"sessionId": id, "prompt": content}),
        )
        .await?;
    loop {
        tokio::select! {
            biased;
            event = rpc.events.recv() => { let Some(event) = event else { return acp_completion(result.await.map_err(|_| "CLI-Verbindung geschlossen")??, run); }; native_event(&rpc, &event, run).await?; }
            response = &mut result => return acp_completion(response.map_err(|_| "CLI-Verbindung geschlossen")??, run),
        }
    }
}

async fn claude(
    request: &RunRequest,
    instructions: &str,
    bridge: &Bridge,
    run: &Run,
) -> Result<(), String> {
    let fresh_prompt = claude_fresh_prompt(&request.profile).await;
    if !fresh_prompt
        && request.session_id.is_some()
        && request
            .messages
            .last()
            .is_some_and(|message| message.text.trim_start().starts_with('/'))
    {
        return Err("Native Slash-Kommandos mit aktuellem Verbindungskontext benötigen eine neuere Claude-Code-Version. CLI aktualisieren.".into());
    }
    let mut command = launch(&request.profile, &request.cwd)?;
    command.arg("--append-system-prompt").arg(instructions);
    if fresh_prompt {
        command.args(["--system-prompt-snapshot", "off"]);
    }
    command
        .arg("--mcp-config")
        .arg(json!({"mcpServers": {"l8db_ai": bridge.mcp()?}}).to_string());
    if !request.profile.model.is_empty() {
        command.arg("--model").arg(&request.profile.model);
    }
    if !request.profile.effort.is_empty() {
        command.arg("--effort").arg(&request.profile.effort);
    }
    if let Some(session) = &request.session_id {
        command.arg("--resume").arg(session);
    }
    let mut rpc = Rpc::spawn(&mut command)?;
    run.emit("metadata", claude_init(&mut rpc).await?);
    rpc.send(json!({"type": "user", "message": {"role": "user", "content": if fresh_prompt || request.session_id.is_none() { conversation(request, request.session_id.is_some()) } else { prompt(request, instructions, true) }}, "parent_tool_use_id": null, "session_id": request.session_id.as_deref().unwrap_or("")})).await?;
    let mut partial = false;
    loop {
        let event = rpc
            .events
            .recv()
            .await
            .ok_or("Claude Code beendet. Anmeldung und CLI-Version prüfen.")?;
        if let Some(id) = event["session_id"].as_str() {
            run.emit("session", json!({"sessionId": id}));
        }
        if let Some(text) = delta(&event) {
            partial = true;
            run.emit("text", json!({"delta": text}));
        }
        if event["type"] == "stream_event" && event["event"]["delta"]["type"] == "thinking_delta" {
            run.emit(
                "reasoning",
                json!({"delta": event["event"]["delta"]["thinking"]}),
            );
        }
        match event["type"].as_str().unwrap_or("") {
            "control_request" => {
                let request = &event["request"];
                let response = match request["subtype"].as_str().unwrap_or("") {
                    "can_use_tool" if request["tool_name"] == "AskUserQuestion" => {
                        let mut questions = request["input"].clone();
                        for question in questions["questions"].as_array_mut().into_iter().flatten() {
                            question["id"] = question["question"].clone();
                        }
                        let answer = run.input("Claude-Rückfrage", questions).await?;
                        if answer["answers"].is_object() {
                            let mut updated = request["input"].clone();
                            updated["answers"] = Value::Object(answer["answers"].as_object().into_iter().flatten().map(|(key, value)| {
                                let text = value.as_str().map(str::to_string).unwrap_or_else(|| value["answers"].as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(", "));
                                (key.clone(), json!(text))
                            }).collect());
                            json!({"behavior": "allow", "updatedInput": updated})
                        } else { json!({"behavior": "deny", "message": "Benutzer hat die Rückfrage abgebrochen"}) }
                    }
                    "can_use_tool" => {
                        if run.plan_only && matches!(request["tool_name"].as_str(), Some("ExitPlanMode" | "Bash" | "PowerShell" | "Edit" | "Write" | "NotebookEdit")) {
                            rpc.send(json!({"type":"control_response","response":{"subtype":"success","request_id":event["request_id"],"response":{"behavior":"deny","message":"Im Planmodus sind Änderungen und Shell-Ausführung gesperrt"}}})).await?;
                            continue;
                        }
                        let allowed = run.approve_tool(request["tool_name"].as_str().is_some_and(|name| name.starts_with("mcp__")), &format!("Claude-Tool: {}", request["tool_name"].as_str().unwrap_or("Tool")), request["input"].clone()).await?;
                        if allowed { json!({"behavior": "allow", "updatedInput": request["input"]}) } else { json!({"behavior": "deny", "message": "Benutzer hat die Aktion abgelehnt"}) }
                    }
                    _ => json!({"behavior": "deny", "message": "Client capability unavailable"})
                };
                rpc.send(json!({"type": "control_response", "response": {"subtype": "success", "request_id": event["request_id"], "response": response}})).await?;
            }
            "assistant" => {
                for block in event["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"] == "text" && !partial { if let Some(text) = block["text"].as_str() { run.emit("text", json!({"delta": text})); } }
                    if block["type"] == "tool_use" { run.emit("tool", json!({"id": block["id"], "name": block["name"], "arguments": block["input"], "status": "running"})); }
                }
                partial = false;
            }
            "user" => for block in event["message"]["content"].as_array().into_iter().flatten() { if block["type"] == "tool_result" { run.emit("tool", json!({"id": block["tool_use_id"], "result": block["content"], "status": if block["is_error"] == true { "error" } else { "completed" }})); } },
            "result" => { run.emit("usage", json!({"usage": event["usage"], "modelUsage": event["modelUsage"], "total_cost_usd": event["total_cost_usd"]})); if event["is_error"] == true { return Err("Claude Code konnte die Anfrage nicht abschließen. Anmeldung und Kontingent prüfen.".into()); } return Ok(()); }
            "system" => run.emit("metadata", json!({"tools": event["tools"], "mcpServers": event["mcp_servers"], "skills": event["skills"], "model": event["model"]})),
            _ => {}
        }
    }
}

pub async fn run(
    request: &RunRequest,
    instructions: &str,
    bridge: &Bridge,
    run: &Run,
) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(1800), async {
        match request.profile.provider.as_str() {
            "codex" => codex(request, instructions, bridge, run).await,
            "claude" => claude(request, instructions, bridge, run).await,
            _ => acp(request, instructions, bridge, run).await,
        }
    })
    .await
    .map_err(|_| "CLI-Anfrage überschreitet 30 Minuten. Erneut versuchen.")?
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;
