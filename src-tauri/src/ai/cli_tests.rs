use super::*;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

#[test]
fn acp_config_catalog_supports_grouped_models_and_current_modes() {
    let session = json!({"configOptions": [
        {"id":"model", "category":"model", "options":[{"group":"native", "options":[{"value":"native/model", "name":"Configured model"}]}]},
        {"id":"mode", "category":"mode", "currentValue":"plan", "options":[{"value":"plan", "name":"Plan"}]}
    ]});
    assert_eq!(
        session_models(&session),
        vec![json!({"id":"native/model", "name":"Configured model"})]
    );
    assert_eq!(session_modes(&session)["currentModeId"], "plan");
    assert!(option_contains(
        &session["configOptions"][0]["options"],
        &json!("native/model")
    ));
    assert!(!option_contains(
        &session["configOptions"][0]["options"],
        &json!("unknown")
    ));
}

#[tokio::test]
async fn session_load_drains_large_replay_without_emitting_duplicate_history() {
    let mut command = tokio::process::Command::new("python3");
    command.args(["-u", "-c", "import sys,json\nr=json.loads(sys.stdin.readline())\nfor i in range(300): print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'old history'}}}}),flush=True)\nprint(json.dumps({'jsonrpc':'2.0','id':r['id'],'result':{'sessionId':'native-session'}}),flush=True)\nsys.stdin.readline()"]);
    let mut rpc = Rpc::spawn(&mut command).unwrap();
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captured = events.clone();
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(body) = body {
            captured
                .lock()
                .unwrap()
                .push(serde_json::from_str(&body).unwrap());
        }
        Ok(())
    });
    let run = Run {
        id: "fixture".into(),
        owner: "fixture-window".into(),
        state: Arc::new(super::super::runtime::AiState::default()),
        channel,
        plan_only: false,
    };
    let response = tokio::time::timeout(
        Duration::from_secs(5),
        native_request(&mut rpc, "session/load", json!({}), &run, true),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response["sessionId"], "native-session");
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn rpc_rejects_unsupported_methods_without_exposing_error_secrets() {
    let mut command = tokio::process::Command::new("python3");
    command.args(["-u", "-c", "import sys,json\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({'jsonrpc':'2.0','id':r['id'],'error':{'code':-32601,'message':'private-token-do-not-expose'}}),flush=True)\nsys.stdin.readline()"]);
    let rpc = Rpc::spawn(&mut command).unwrap();
    let error = rpc.request("unknown", json!({})).await.unwrap_err();
    assert!(error.contains("CLI aktualisieren"));
    assert!(!error.contains("private-token"));
}

#[tokio::test]
#[ignore]
async fn native_cli_reads_scoped_sqlite() {
    use super::super::{context, integrations, runtime::AiState};
    use crate::mcp::{config::McpConfig, server::Server};
    let providers =
        std::env::var("L8DB_AI_NATIVE_PROVIDERS").expect("Explicitly select installed native CLIs");
    assert!(std::env::var_os("L8DB_AI_RELAY_EXECUTABLE").is_some());
    for provider in providers.split(',').filter(|provider| !provider.is_empty()) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("native-fixture.sqlite");
        let database = rusqlite::Connection::open(&path).unwrap();
        database.execute_batch("CREATE TABLE native_probe(value TEXT); INSERT INTO native_probe VALUES ('l8db-native-verified');").unwrap();
        drop(database);
        let mut request: RunRequest = serde_json::from_value(json!({"runId":"native-fixture", "profile":{"id":"native-fixture", "provider":provider}, "cwd":directory.path(), "sessionId":null, "messages":[{"role":"user", "text":"Use only l8db_ai MCP tools. Describe native_probe on connection native-fixture, then query SELECT value FROM native_probe and return the value. Do not use shell, filesystem tools, external MCP servers, or modify anything."}], "connections":[{"id":"native-fixture", "name":"native-fixture", "kind":"sqlite", "connectionString":format!("sqlite://{}", path.display()), "readOnly":true}], "activeId":"native-fixture"})).unwrap();
        let events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured = events.clone();
        let state = Arc::new(AiState::default());
        let approvals = state.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(body) = body {
                let event: Value = serde_json::from_str(&body).unwrap();
                if event["kind"] == "approval" {
                    let key = format!(
                        "native-window:native-fixture:{}",
                        event["data"]["id"].as_str().unwrap()
                    );
                    if let Some(sender) = approvals.approvals.lock().unwrap().remove(&key) {
                        let private_native_id = captured.lock().unwrap().iter().any(|prior| {
                            prior["kind"] == "tool"
                                && prior["data"]["name"]
                                    .as_str()
                                    .is_some_and(|name| name.starts_with("l8db_ai-"))
                                && prior["data"]["id"] == event["data"]["details"]["toolCallId"]
                        });
                        let bridge_tool = private_native_id
                            || event["data"]["details"].to_string().contains("l8db_ai")
                            || event["data"]["title"]
                                .as_str()
                                .is_some_and(|title| title.contains("mcp__l8db_ai__"));
                        let _ = sender.send(json!(bridge_tool));
                    }
                }
                if event["kind"] == "input" {
                    let key = format!(
                        "native-window:native-fixture:{}",
                        event["data"]["id"].as_str().unwrap()
                    );
                    if let Some(sender) = approvals.approvals.lock().unwrap().remove(&key) {
                        let allowed = event["data"]["details"]["serverName"] == "l8db_ai"
                            && event["data"]["details"]["requestedSchema"]["properties"]
                                .as_object()
                                .is_some_and(|fields| fields.is_empty());
                        let _ = sender.send(json!({"action": if allowed {"accept"} else {"decline"}, "content": {}}));
                    }
                }
                captured.lock().unwrap().push(event);
            }
            Ok(())
        });
        let run = Arc::new(Run {
            id: "native-fixture".into(),
            owner: "native-window".into(),
            state,
            channel,
            plan_only: super::super::context::is_plan(&request),
        });
        for turn in 0..2 {
            let expected = if turn == 0 {
                "l8db-native-verified"
            } else {
                "l8db-resumed-verified"
            };
            if turn == 1 {
                request.session_id = events
                    .lock()
                    .unwrap()
                    .iter()
                    .rev()
                    .find(|event| event["kind"] == "session")
                    .and_then(|event| event["data"]["sessionId"].as_str())
                    .map(str::to_string);
                assert!(
                    request.session_id.is_some(),
                    "{provider}: native session cursor missing"
                );
                request.connections[0].id = "resumed-fixture".into();
                request.connections[0].name = "resumed-fixture".into();
                request.active_id = Some("resumed-fixture".into());
                request.messages.push(super::super::types::Message { role:"user".into(), text:"The current connection is now resumed-fixture, and native-fixture is no longer selected. Use the current l8db_ai MCP tools to describe native_probe on resumed-fixture and query SELECT value FROM native_probe again. Do not use cached results, shell, filesystem tools or external MCP servers.".into() });
                let database = rusqlite::Connection::open(&path).unwrap();
                database
                    .execute("UPDATE native_probe SET value = ?1", [expected])
                    .unwrap();
            }
            events.lock().unwrap().clear();
            let config = context::scoped_config(&request, McpConfig::default()).unwrap();
            let server = Arc::new(tokio::sync::Mutex::new(Server {
                pool: crate::db::pool::PoolState::default(),
                columns: Default::default(),
            }));
            let external = integrations::connect(&[], directory.path(), &run)
                .await
                .unwrap();
            let bridge = Bridge::start(server, config, run.clone(), external)
                .await
                .unwrap();
            let result = tokio::time::timeout(
                Duration::from_secs(180),
                super::run(&request, &context::instructions(&request), &bridge, &run),
            )
            .await;
            assert!(
                matches!(result, Ok(Ok(()))),
                "{provider} turn {turn}: {}",
                match result {
                    Ok(Err(error)) => error,
                    Err(_) => "native turn exceeded 180 seconds".into(),
                    _ => String::new(),
                }
            );
            assert!(
                events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|event| event["kind"] == "tool"
                        && event["data"]["name"] == "query"
                        && event["data"]["status"] == "completed"
                        && event["data"]["result"].to_string().contains(expected)),
                "{provider} turn {turn}: native MCP query did not return the current fixture value"
            );
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn native_protocol_fixtures_stream_once_and_complete() {
    use super::super::{integrations, runtime::AiState};
    use crate::mcp::{config::McpConfig, server::Server};
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let binary = directory.path().join("native-fixture");
    std::fs::write(&binary, r#"#!/usr/bin/env python3
import sys,json
if '--help' in sys.argv:
 print('--system-prompt-snapshot'); sys.exit(0)
def out(value): print(json.dumps(value),flush=True)
def reply(request,value): out({'jsonrpc':'2.0','id':request['id'],'result':value})
claude='--print' in sys.argv
codex='app-server' in sys.argv
safe_mode=False
def check_approval(value):
 if isinstance(value,dict):
  assert value['granular']=={'sandbox_approval':False,'rules':False,'mcp_elicitations':True,'request_permissions':False,'skill_approval':True}
 else: assert value=='untrusted'
if claude:
 assert '--permission-mode' in sys.argv
 assert sys.argv[sys.argv.index('--permission-mode')+1] in ['default','plan']
for line in sys.stdin:
 request=json.loads(line)
 if claude:
  if request.get('type')=='control_request':
   out({'type':'control_response','response':{'subtype':'success','request_id':request['request_id'],'response':{'models':[]}}})
  if request.get('type')=='user':
   if sys.argv[sys.argv.index('--permission-mode')+1]=='plan':
    out({'type':'control_request','request_id':'fixture-plan-escape','request':{'subtype':'can_use_tool','tool_name':'ExitPlanMode','input':{}}})
    denied=json.loads(sys.stdin.readline())
    assert denied['response']['response']['behavior']=='deny'
   out({'type':'system','session_id':'fixture-session','tools':[]})
   out({'type':'stream_event','event':{'delta':{'type':'text_delta','text':'fixture streamed response'}}})
   out({'type':'assistant','message':{'content':[{'type':'text','text':'fixture streamed response'}]}})
   out({'type':'result','is_error':False})
  continue
 method=request.get('method')
 if method=='initialize': reply(request,{'agentCapabilities':{'loadSession':True}})
 elif method in ['thread/start','thread/resume']:
  assert request['params']['sandbox']=='read-only'
  check_approval(request['params']['approvalPolicy'])
  reply(request,{'thread':{'id':'fixture-session'}})
 elif method=='turn/start':
  assert request['params']['sandboxPolicy']=={'type':'readOnly','networkAccess':False}
  check_approval(request['params']['approvalPolicy'])
  reply(request,{'turn':{'id':'fixture-turn'}})
  if isinstance(request['params']['approvalPolicy'],dict):
   out({'jsonrpc':'2.0','id':'fixture-plan-escalation','method':'item/permissions/requestApproval','params':{'permissions':{'network':{'enabled':True}}}})
   denied=json.loads(sys.stdin.readline())
   assert denied['result']['permissions']=={}
   out({'jsonrpc':'2.0','id':'fixture-plan-command','method':'item/commandExecution/requestApproval','params':{'command':['sh','-c','touch denied']}})
   denied=json.loads(sys.stdin.readline())
   assert denied['result']['decision']=='decline'
  out({'method':'turn/plan/updated','params':{'plan':[{'step':'Inspect current database','status':'inProgress'}],'explanation':'Database task'}})
  out({'method':'turn/diff/updated','params':{'diff':'--- a/query.sql\n+++ b/query.sql\n@@ -1 +1 @@\n-SELECT 1;\n+SELECT 2;'}})
  out({'method':'item/completed','params':{'item':{'id':'fixture-file','type':'fileChange','status':'completed','changes':[{'path':'query.sql','diff':'-SELECT 1;\n+SELECT 2;','kind':{'type':'update'}}]}}})
  out({'method':'item/completed','params':{'item':{'id':'fixture-image','type':'imageGeneration','status':'completed','result':'cG5n','revisedPrompt':'Database diagram'}}})
  out({'method':'item/agentMessage/delta','params':{'delta':'fixture streamed response'}})
  out({'method':'item/completed','params':{'item':{'id':'fixture-message','type':'agentMessage','text':'fixture streamed response','memoryCitation':{'entries':[{'path':'MEMORY.md','lineStart':1,'lineEnd':2,'note':'Native memory source'}]}}}})
  out({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
 elif method in ['session/new','session/load']:
  reply(request,{'sessionId':'fixture-session','modes':{'currentModeId':'autopilot','availableModes':[{'id':'autopilot'},{'id':'interactive'}]},'configOptions':[{'id':'model','category':'model','options':[{'value':'fixture-model','name':'Fixture'}]}]})
 elif method=='session/set_mode':
  assert request['params']['modeId']=='interactive'
  safe_mode=True
  reply(request,{'modes':{'currentModeId':'interactive'}})
 elif method=='session/set_config_option':
  assert request['params']['configId']=='model'
  assert request['params']['value']=='fixture-model'
  reply(request,{})
 elif method=='session/prompt':
  assert safe_mode
  out({'jsonrpc':'2.0','method':'session/update','params':{'update':{'sessionUpdate':'plan','entries':[{'content':'Inspect current database','status':'in_progress','priority':'high'}]}}})
  out({'jsonrpc':'2.0','method':'session/update','params':{'update':{'sessionUpdate':'tool_call','toolCallId':'fixture-file','title':'Edit query','kind':'edit','status':'in_progress','rawInput':{'path':'query.sql'},'content':[{'type':'diff','path':'query.sql','oldText':'SELECT 1;','newText':'SELECT 2;'}],'locations':[{'path':'query.sql','line':1}]}}})
  out({'jsonrpc':'2.0','method':'session/update','params':{'update':{'sessionUpdate':'tool_call_update','toolCallId':'fixture-file','status':'completed'}}})
  out({'jsonrpc':'2.0','method':'session/update','params':{'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'image','data':'cG5n','mimeType':'image/png'}}}})
  out({'jsonrpc':'2.0','method':'session/update','params':{'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'fixture streamed response'}}}})
  reply(request,{'stopReason':'end_turn'})
"#).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    for (provider, mode, session_id) in [
        ("codex", "", None),
        ("codex", "plan", Some("fixture-session")),
        ("claude", "", None),
        ("claude", "plan", Some("fixture-session")),
        ("gemini-cli", "", None),
        ("opencode", "", None),
        ("copilot", "", None),
    ] {
        let request: RunRequest = serde_json::from_value(json!({"runId":"fixture", "profile":{"id":"fixture", "provider":provider, "binary":binary, "model":"fixture-model", "mode":mode}, "cwd":directory.path(), "sessionId":session_id, "messages":[{"role":"user", "text":"fixture input"}], "connections":[], "activeId":null})).unwrap();
        let events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured = events.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(body) = body {
                captured
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&body).unwrap());
            }
            Ok(())
        });
        let run = Arc::new(Run {
            id: "fixture".into(),
            owner: "fixture-window".into(),
            state: Arc::new(AiState::default()),
            channel,
            plan_only: super::super::context::is_plan(&request),
        });
        let server = Arc::new(tokio::sync::Mutex::new(Server {
            pool: crate::db::pool::PoolState::default(),
            columns: Default::default(),
        }));
        let external = integrations::connect(&[], directory.path(), &run)
            .await
            .unwrap();
        let bridge = Bridge::start(server, McpConfig::default(), run.clone(), external)
            .await
            .unwrap();
        tokio::time::timeout(
            Duration::from_secs(5),
            super::run(&request, "fixture context", &bridge, &run),
        )
        .await
        .unwrap()
        .unwrap();
        let text = events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == "text")
            .filter_map(|event| event["data"]["delta"].as_str())
            .collect::<String>();
        assert_eq!(
            text, "fixture streamed response",
            "{provider}: duplicate or missing text"
        );
        let captured = events.lock().unwrap();
        if provider == "codex" {
            assert!(captured.iter().any(|event| event["kind"] == "metadata"
                && event["data"]["plan"][0]["step"] == "Inspect current database"));
            assert!(captured.iter().any(|event| event["kind"] == "metadata"
                && event["data"]["diff"]
                    .as_str()
                    .is_some_and(|diff| diff.contains("query.sql"))));
            assert!(captured.iter().any(|event| event["kind"] == "tool"
                && event["data"]["result"]["changes"][0]["path"] == "query.sql"));
            assert!(captured.iter().any(|event| event["kind"] == "tool"
                && event["data"]["result"]["type"] == "imageGeneration"
                && event["data"]["result"]["result"] == "cG5n"));
            assert!(captured.iter().any(|event| event["kind"] == "metadata"
                && event["data"]["citations"][0]["path"] == "MEMORY.md"));
        } else if provider != "claude" {
            assert!(captured.iter().any(
                |event| event["kind"] == "metadata" && event["data"]["sessionUpdate"] == "plan"
            ));
            let tools = captured
                .iter()
                .filter(|event| event["kind"] == "tool")
                .collect::<Vec<_>>();
            assert_eq!(tools[0]["data"]["kind"], "edit");
            assert_eq!(tools[0]["data"]["locations"][0]["path"], "query.sql");
            assert_eq!(
                tools[0]["data"]["result"]["content"][0]["newText"],
                "SELECT 2;"
            );
            assert_eq!(tools[1]["data"]["status"], "completed");
            assert!(tools[1]["data"].get("name").is_none());
            assert!(tools[1]["data"].get("arguments").is_none());
            assert!(tools[1]["data"].get("result").is_none());
            assert!(captured.iter().any(|event| event["kind"] == "artifact"
                && event["data"]["content"]["mimeType"] == "image/png"));
        }
    }
}

#[test]
fn permission_bypass_modes_are_rejected_including_native_uri_values() {
    for value in [
        "autopilot",
        "https://agentclientprotocol.com/protocol/session-modes#autopilot",
        "bypassPermissions",
        "danger-full-access",
        "allow_all",
        "auto",
    ] {
        assert!(bypass_permissions("mode", &json!(value)));
    }
    assert!(bypass_permissions("allow_all_tools", &json!(true)));
    assert!(bypass_permissions("approval_policy", &json!("never")));
    assert!(!bypass_permissions("mode", &json!("plan")));
    assert!(!bypass_permissions(
        "mode",
        &json!("https://agentclientprotocol.com/protocol/session-modes#interactive")
    ));
}

#[test]
fn automatic_model_and_reasoning_options_preserve_permission_boundaries() {
    for id in [
        "mode",
        "agent_mode",
        "sessionMode",
        "approval_policy",
        "permissionMode",
    ] {
        assert!(bypass_permissions(id, &json!("auto")));
    }
    for id in ["model", "reasoning", "thinking_mode", "reasoningMode"] {
        assert!(!bypass_permissions(id, &json!("auto")));
    }
    assert!(inherited_permission_changes(&json!({"configOptions":[{"id":"reasoning","currentValue":"auto","options":[{"value":"auto"}]}]}), "").unwrap().is_empty());
    assert!(inherited_permission_changes(&json!({"configOptions":[{"id":"model","currentValue":"auto","options":[{"value":"auto"}]}]}), "").unwrap().is_empty());
    assert_eq!(inherited_permission_changes(&json!({"configOptions":[{"id":"custom_agent","category":"mode","currentValue":"auto","options":[{"value":"auto"},{"value":"plan"}]}]}), "").unwrap(), vec![json!({"method":"session/set_config_option","params":{"configId":"custom_agent","value":"plan"}})]);
}

#[test]
fn acp_plan_permissions_require_safe_read_kind_or_private_read_provenance() {
    for kind in ["read", "search"] {
        assert!(acp_plan_read(&json!({"kind": kind})));
    }
    assert!(acp_plan_read(
        &json!({"kind":"other","title":"l8db_ai-query"})
    ));
    assert!(acp_plan_read(
        &json!({"rawInput":{"serverName":"l8db_ai","toolName":"describe"}})
    ));
    for kind in ["edit", "delete", "execute", "unknown"] {
        assert!(!acp_plan_read(
            &json!({"kind":kind,"title":"l8db_ai-query"})
        ));
    }
    assert!(!acp_plan_read(
        &json!({"kind":"other","title":"l8db_ai-execute"})
    ));
    assert!(!acp_plan_read(
        &json!({"kind":"other","title":"external-l8db_ai-query"})
    ));
    assert!(!acp_plan_read(
        &json!({"rawInput":{"serverName":"external","toolName":"query"}})
    ));
    assert!(!acp_plan_read(&json!({})));
}

#[tokio::test]
async fn acp_plan_rejects_modifying_and_unknown_permissions_before_asking() {
    let mut command = tokio::process::Command::new("python3");
    command.args(["-u", "-c", r#"import sys,json
request=json.loads(sys.stdin.readline())
for kind in ['edit','delete','execute','unknown','other']:
 print(json.dumps({'jsonrpc':'2.0','id':kind,'method':'session/request_permission','params':{'toolCall':{'toolCallId':kind,'kind':kind,'title':'Change data'},'options':[{'optionId':'allow','kind':'allow_once'},{'optionId':'reject','kind':'reject_once'}]}}),flush=True)
 response=json.loads(sys.stdin.readline())
 assert response['result']['outcome']=={'outcome':'selected','optionId':'reject'}
print(json.dumps({'jsonrpc':'2.0','id':request['id'],'result':{'rejected':5}}),flush=True)
sys.stdin.readline()
"#]);
    let mut rpc = Rpc::spawn(&mut command).unwrap();
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captured = events.clone();
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(body) = body {
            captured
                .lock()
                .unwrap()
                .push(serde_json::from_str(&body).unwrap());
        }
        Ok(())
    });
    let run = Run {
        id: "plan-fixture".into(),
        owner: "fixture-window".into(),
        plan_only: true,
        state: Arc::new(super::super::runtime::AiState::default()),
        channel,
    };
    let response = tokio::time::timeout(
        Duration::from_secs(5),
        native_request(&mut rpc, "fixture/run", json!({}), &run, false),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response["rejected"], 5);
    assert!(events
        .lock()
        .unwrap()
        .iter()
        .all(|event| event["kind"] != "approval"));
}

#[test]
fn inherited_acp_bypass_uses_only_advertised_safe_options() {
    let session = json!({"modes": {"currentModeId": "autopilot", "availableModes": [{"id": "autopilot"}, {"id": "interactive"}]}, "configOptions": [{"id": "allow_all_tools", "currentValue": true, "options": [{"value": true}, {"value": false}]}, {"id": "mode", "category": "mode", "currentValue": "bypassPermissions", "options": [{"group": "modes", "options": [{"value": "plan"}]}]}]});
    let changes = inherited_permission_changes(&session, "").unwrap();
    assert_eq!(
        changes,
        vec![
            json!({"method":"session/set_config_option", "params":{"configId":"allow_all_tools", "value":false}}),
            json!({"method":"session/set_config_option", "params":{"configId":"mode", "value":"plan"}}),
        ]
    );
    assert_eq!(
        inherited_permission_changes(
            &json!({"modes":{"currentModeId":"autopilot","availableModes":[{"id":"interactive"}]}}),
            ""
        )
        .unwrap(),
        vec![json!({"method":"session/set_mode","params":{"modeId":"interactive"}})]
    );
    assert!(inherited_permission_changes(
        &json!({"modes":{"currentModeId":"autopilot","availableModes":[{"id":"autopilot"}]}}),
        ""
    )
    .is_err());
    assert!(inherited_permission_changes(&json!({"configOptions":[{"id":"allow_all_tools","currentValue":true,"options":[{"value":true}]}]}), "").is_err());
    assert!(inherited_permission_changes(&json!({"configOptions":[{"id":"approval_policy","currentValue":"never","options":[{"value":"never"}]}]}), "").is_err());
    assert!(inherited_permission_changes(&json!({"modes":{"currentModeId":"plan"},"configOptions":[{"id":"model","currentValue":"native/model"}]}), "").unwrap().is_empty());
}

#[test]
fn copilot_session_mcp_config_uses_native_local_schema_without_permission_bypass() {
    let config = copilot_bridge_config(
        &json!({"command":"/private/relay", "args":["--ai-mcp-relay", "/private/address"]}),
    );
    assert_eq!(config["mcpServers"]["l8db_ai"]["type"], "local");
    assert_eq!(config["mcpServers"]["l8db_ai"]["command"], "/private/relay");
    assert_eq!(config["mcpServers"]["l8db_ai"]["tools"], json!(["*"]));
    assert_eq!(config["mcpServers"]["l8db_ai"]["env"], json!({}));
    assert!(!config.to_string().contains("allow-all"));
}
