use serde_json::{json, Map, Value};

use super::pool::create_pool_state;
use super::{create_adapter_from_string, DatabaseKind};

fn kind_of(name: &str) -> DatabaseKind {
    serde_json::from_value(json!(name)).unwrap_or_else(|_| panic!("unbekannte Familie {name}"))
}

async fn execute(adapter: &dyn super::DatabaseAdapter, step: &Value) -> Value {
    let sql = step["sql"].as_str().unwrap_or("");
    let outcome = match step["params"].as_array() {
        Some(params) => {
            let values: Vec<Option<String>> = params
                .iter()
                .map(|value| value.as_str().map(str::to_string))
                .collect();
            adapter.execute_query_with_params(sql, &values).await
        }
        None => adapter.execute_query(sql).await,
    };
    match outcome {
        Ok(result) => json!({"ok": true, "result": result}),
        Err(error) => json!({"ok": false, "error": error}),
    }
}

#[tokio::test]
#[ignore]
async fn live_plan() {
    let plan_path = std::env::var("L8DB_LIVE_PLAN").expect("L8DB_LIVE_PLAN fehlt");
    let out_path = std::env::var("L8DB_LIVE_OUT").expect("L8DB_LIVE_OUT fehlt");
    let plan: Value = serde_json::from_str(&std::fs::read_to_string(plan_path).unwrap()).unwrap();
    let pool = create_pool_state();
    let mut output = Map::new();
    for case in plan["cases"].as_array().cloned().unwrap_or_default() {
        let name = case["name"].as_str().unwrap().to_string();
        let adapter = create_adapter_from_string(
            kind_of(case["kind"].as_str().unwrap()),
            case["url"].as_str().unwrap(),
            case["database"].as_str(),
            pool.clone(),
        )
        .unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut results = Map::new();
        for step in case["steps"].as_array().cloned().unwrap_or_default() {
            let times = step["times"].as_u64().unwrap_or(1).max(1);
            let mut last = Value::Null;
            for _ in 0..times {
                last = execute(adapter.as_ref(), &step).await;
            }
            if step["pause_ms"].as_u64().is_some() {
                tokio::time::sleep(std::time::Duration::from_millis(
                    step["pause_ms"].as_u64().unwrap(),
                ))
                .await;
            }
            if step["must_succeed"].as_bool().unwrap_or(false)
                && !last["ok"].as_bool().unwrap_or(false)
            {
                panic!("{name} {}: {}", step["id"], last["error"]);
            }
            if let Some(id) = step["id"].as_str() {
                results.insert(id.to_string(), last);
            }
        }
        output.insert(name, Value::Object(results));
    }
    std::fs::write(
        out_path,
        serde_json::to_vec_pretty(&Value::Object(output)).unwrap(),
    )
    .unwrap();
}
