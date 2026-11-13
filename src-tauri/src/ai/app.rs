use super::runtime::Run;
use serde_json::{json, Value};

pub fn definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "app_search",
            "description": "Search l8db features, UI help and documentation. Returns at most five local feature IDs and three docs IDs, without full pages. Works without a database connection. Use for questions about features or how to use l8db.",
            "inputSchema": {"type": "object", "properties": {
                "query": {"type": "string", "maxLength": 200}
            }, "required": ["query"]}
        }),
        json!({
            "name": "app_execute",
            "description": "Use an ID from app_search: read_doc returns a 4000-character Markdown excerpt (offset pages it); open_doc opens docs in l8db; show_feature highlights a UI element; guide_feature starts its interactive walkthrough. Show/open/guide only when requested or clearly implied. Never clicks database actions or changes settings. To include clickable feature cards in an answer use a fenced feature block with at most two feature IDs.",
            "inputSchema": {"type": "object", "properties": {
                "action": {"type": "string", "enum": ["read_doc", "open_doc", "show_feature", "guide_feature"]},
                "id": {"type": "string", "maxLength": 180},
                "offset": {"type": "integer", "minimum": 0}
            }, "required": ["action", "id"]}
        }),
    ]
}

pub async fn call(run: &Run, name: &str, args: Value) -> Value {
    let id = super::new_id();
    run.emit(
        "tool",
        json!({"id": id, "name": name, "arguments": args, "status": "running"}),
    );
    let outcome = dispatch(run, name, &args).await;
    let (text, error) = match outcome {
        Ok(text) => (text, false),
        Err(text) => (text, true),
    };
    let result = json!({"content": [{"type": "text", "text": text}], "isError": error});
    run.emit("tool", json!({"id": id, "name": name, "result": result, "status": if error { "error" } else { "completed" }}));
    result
}

async fn ui(run: &Run, details: Value) -> Result<String, String> {
    let answer = run.app(details).await?;
    let text = answer["text"]
        .as_str()
        .unwrap_or("Keine Antwort aus der Oberfläche.");
    let text: String = text.chars().take(2400).collect();
    if answer["ok"] == true {
        Ok(text)
    } else {
        Err(text)
    }
}

async fn dispatch(run: &Run, name: &str, args: &Value) -> Result<String, String> {
    if name == "app_search" {
        let query = args["query"]
            .as_str()
            .filter(|query| !query.trim().is_empty() && query.chars().count() <= 200)
            .ok_or("query braucht 1 bis 200 Zeichen.")?;
        let features = ui(run, json!({"action": "search", "query": query})).await?;
        let docs = match super::app_docs::search(query).await {
            Ok(docs) => docs.to_string(),
            Err(error) => format!("Unavailable: {error}"),
        };
        return Ok(format!(
            "Features (local catalog):\n{features}\nDocs:\n{docs}"
        ));
    }
    let action = args["action"].as_str().unwrap_or("");
    let id = args["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 180)
        .ok_or("id aus app_search verwenden.")?;
    match action {
        "read_doc" => {
            let offset = match args.get("offset") {
                None => 0,
                Some(offset) => offset
                    .as_u64()
                    .ok_or("offset muss eine nichtnegative Ganzzahl sein.")?,
            };
            super::app_docs::read(id, usize::try_from(offset).unwrap_or(usize::MAX)).await
        }
        "open_doc" => {
            super::app_docs::validate(id).await?;
            ui(run, json!({"action": action, "id": id})).await
        }
        "show_feature" | "guide_feature" => ui(run, json!({"action": action, "id": id})).await,
        _ => Err("Unbekannte App-Aktion.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_tools_are_optional_and_have_constant_schema_cost() {
        let config = crate::mcp::config::McpConfig::default();
        let mut catalog = crate::ai::tools::Catalog::new(&config, false, &[]);
        assert!(!catalog
            .tools()
            .iter()
            .any(|tool| tool["name"] == "app_search" || tool["name"] == "app_execute"));
        let result = catalog.discover(&json!({"names": ["app_search", "app_execute"]}));
        assert_eq!(result["isError"], false);
        assert_eq!(
            catalog
                .tools()
                .iter()
                .filter(|tool| tool["name"] == "app_search" || tool["name"] == "app_execute")
                .count(),
            2
        );
        assert!(serde_json::to_string(&definitions()).unwrap().len() < 1800);
    }

    #[tokio::test]
    async fn app_ui_roundtrip_and_invalid_actions_need_no_database() {
        use std::sync::{Arc, Mutex};
        use tauri::ipc::{Channel, InvokeResponseBody};
        let state = Arc::new(super::super::runtime::AiState::default());
        let responder = state.clone();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let channel = Channel::new(move |body| {
            let InvokeResponseBody::Json(body) = body else {
                panic!("JSON expected")
            };
            let event: Value = serde_json::from_str(&body).unwrap();
            if event["kind"] == "app" {
                let key = format!("window:run:{}", event["data"]["id"].as_str().unwrap());
                responder
                    .approvals
                    .lock()
                    .unwrap()
                    .remove(&key)
                    .unwrap()
                    .send(json!({"ok": true, "text": "Gezeigt"}))
                    .unwrap();
            }
            captured.lock().unwrap().push(event);
            Ok(())
        });
        let run = Run {
            scope: Default::default(),
            id: "run".into(),
            owner: "window".into(),
            plan_only: true,
            approval: "ask".into(),
            state: state.clone(),
            channel,
        };
        let result = call(
            &run,
            "app_execute",
            json!({"action": "show_feature", "id": "query.format"}),
        )
        .await;
        assert_eq!(result["isError"], false);
        assert_eq!(result["content"][0]["text"], "Gezeigt");
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .map(|event| event["kind"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["tool", "app", "tool"]
        );
        assert!(state.approvals.lock().unwrap().is_empty());
        for args in [
            json!({"action": "shell", "id": "x"}),
            json!({"action": "read_doc", "id": "https://example.org"}),
            json!({"query": ""}),
        ] {
            let name = if args.get("query").is_some() {
                "app_search"
            } else {
                "app_execute"
            };
            assert_eq!(call(&run, name, args).await["isError"], true);
        }
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| event["kind"] == "app")
                .count(),
            1
        );
    }
}
