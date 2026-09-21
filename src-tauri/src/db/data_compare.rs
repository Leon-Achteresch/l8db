use super::{execution, snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareSide {
    pub connection_string: String,
    pub database: Option<String>,
    pub source: snapshot::SnapshotRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRequest {
    pub left: CompareSide,
    pub right: CompareSide,
    pub key_columns: Vec<String>,
    pub compare_columns: Vec<String>,
}

#[derive(Default, Serialize)]
pub struct Counts {
    pub only_left: usize,
    pub only_right: usize,
    pub changed: usize,
    pub equal: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareResult {
    pub rows: Vec<Value>,
    pub counts: Counts,
    pub details_truncated: bool,
}

fn canonical(value: &Value) -> String {
    match value {
        Value::Null => "\0null".into(),
        Value::Bool(value) => format!("b:{value}"),
        Value::String(value) => format!("s:{value}"),
        Value::Number(value) => {
            if value.as_f64() == Some(0.0) {
                return "s:0".into();
            }
            let text = value.to_string();
            format!("s:{}", text.strip_suffix(".0").unwrap_or(&text))
        }
        Value::Array(values) => format!(
            "a:{}",
            serde_json::to_string(&values.iter().map(canonical).collect::<Vec<_>>()).unwrap()
        ),
        Value::Object(values) => {
            let mut entries = values
                .iter()
                .map(|(key, value)| (key, canonical(value)))
                .collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!("o:{}", serde_json::to_string(&entries).unwrap())
        }
    }
}

fn index(rows: Vec<Value>, keys: &[String], side: &str) -> Result<BTreeMap<String, Value>, String> {
    let mut result = BTreeMap::new();
    for row in rows {
        let mut parts = Vec::new();
        for key in keys {
            if row[key].is_null() {
                return Err(format!(
                    "Seite {side}: Schlüsselspalte {key} enthält NULL oder fehlt."
                ));
            }
            parts.push(canonical(&row[key]));
        }
        let key = serde_json::to_string(&parts).map_err(|error| error.to_string())?;
        if result.insert(key, row).is_some() {
            return Err(format!(
                "Seite {side}: Schlüssel ({}) kommt mehrfach vor.",
                keys.join(", ")
            ));
        }
    }
    Ok(result)
}

pub async fn compare(request: &CompareRequest) -> Result<CompareResult, String> {
    if request.key_columns.is_empty() {
        return Err("Vergleich benötigt eindeutige Schlüssel.".into());
    }
    let left = snapshot::read(
        &request.left.connection_string,
        request.left.database.as_deref(),
        &request.left.source,
    )
    .await?;
    let right = snapshot::read(
        &request.right.connection_string,
        request.right.database.as_deref(),
        &request.right.source,
    )
    .await?;
    for name in request.key_columns.iter().chain(&request.compare_columns) {
        if !left.columns.contains(name) || !right.columns.contains(name) {
            return Err(format!("Spalte {name} fehlt auf einer Seite."));
        }
    }
    let left = index(left.rows, &request.key_columns, "links")?;
    let mut right = index(right.rows, &request.key_columns, "rechts")?;
    let mut result = CompareResult {
        rows: vec![],
        counts: Counts::default(),
        details_truncated: false,
    };
    let mut detail_bytes = 0;
    for (key, row) in left {
        if execution::cancellation_token().is_cancelled() {
            return Err("Vergleich abgebrochen; kein vollständiges Ergebnis.".into());
        }
        let other = right.remove(&key);
        let differences: Vec<Value> = request
            .compare_columns
            .iter()
            .filter_map(|column| {
                other.as_ref().and_then(|other| {
                    (canonical(&row[column]) != canonical(&other[column])).then(
                        || json!({ "column": column, "left": row[column], "right": other[column] }),
                    )
                })
            })
            .collect();
        let category = if other.is_none() {
            result.counts.only_left += 1;
            "only_left"
        } else if differences.is_empty() {
            result.counts.equal += 1;
            continue;
        } else {
            result.counts.changed += 1;
            "changed"
        };
        let key_values: serde_json::Map<String, Value> = request
            .key_columns
            .iter()
            .map(|name| (name.clone(), row[name].clone()))
            .collect();
        let detail = json!({ "keyText": key, "keyValues": key_values, "category": category, "left": row, "right": other, "differences": differences });
        append_detail(&mut result, detail, &mut detail_bytes);
    }
    for (key, row) in right {
        result.counts.only_right += 1;
        let key_values: serde_json::Map<String, Value> = request
            .key_columns
            .iter()
            .map(|name| (name.clone(), row[name].clone()))
            .collect();
        append_detail(
            &mut result,
            json!({ "keyText": key, "keyValues": key_values, "category": "only_right", "left": null, "right": row, "differences": [] }),
            &mut detail_bytes,
        );
    }
    if execution::cancellation_token().is_cancelled() {
        return Err("Vergleich abgebrochen; kein vollständiges Ergebnis.".into());
    }
    Ok(result)
}

fn append_detail(result: &mut CompareResult, detail: Value, bytes: &mut usize) {
    let size = detail.to_string().len();
    if result.rows.len() >= 10_000 || *bytes + size > 16 * 1024 * 1024 {
        result.details_truncated = true;
        return;
    }
    *bytes += size;
    result.rows.push(detail);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_is_framed_and_keys_are_unique() {
        assert_ne!(canonical(&json!(["a,s:b"])), canonical(&json!(["a", "b"])));
        assert_ne!(
            canonical(&json!({"a":"x,b=s:y"})),
            canonical(&json!({"a":"x", "b":"y"}))
        );
        assert_eq!(
            canonical(&json!({"a":1,"b":2})),
            canonical(&json!({"b":2,"a":1}))
        );
        assert!(index(vec![json!({"a": null})], &["a".into()], "links").is_err());
        assert!(index(
            vec![json!({"a":1}), json!({"a":"1"})],
            &["a".into()],
            "rechts"
        )
        .is_err());
        assert_eq!(
            index(
                vec![
                    json!({"a":"x\u{0001}s:y","b":"z"}),
                    json!({"a":"x","b":"y\u{0001}s:z"})
                ],
                &["a".into(), "b".into()],
                "links"
            )
            .unwrap()
            .len(),
            2
        );
    }

    #[tokio::test]
    #[ignore]
    async fn compare_large_filtered_and_cancelled() {
        let url = std::env::var("L8DB_E2E_PG_URL").expect("PostgreSQL lab required");
        let (config, ssl) = crate::db::connection::parse_connection(&url, None).unwrap();
        let client = execution::connect_postgres(&config, ssl).await.unwrap();
        client.batch_execute("DROP TABLE IF EXISTS compare_left, compare_right; CREATE TABLE compare_left AS SELECT n AS a, 'key'::text AS b, 'same'::text AS value FROM generate_series(1,100000) n; CREATE TABLE compare_right AS TABLE compare_left; UPDATE compare_right SET value = 'changed' WHERE a = 50000").await.unwrap();
        let side = |table: &str| CompareSide {
            connection_string: url.clone(),
            database: None,
            source: snapshot::SnapshotRequest {
                schema: "public".into(),
                table: table.into(),
                filter: None,
                allow_raw_filter: false,
                order_by: None,
                order_desc: false,
                is_view: false,
                max_rows: 1_000_000,
            },
        };
        let mut request = CompareRequest {
            left: side("compare_left"),
            right: side("compare_right"),
            key_columns: vec!["a".into(), "b".into()],
            compare_columns: vec!["value".into()],
        };
        let start = std::time::Instant::now();
        let result = compare(&request).await.unwrap();
        println!("100000 rows per side compared in {:?}", start.elapsed());
        assert_eq!(result.counts.equal, 99999);
        assert_eq!(result.counts.changed, 1);
        assert_eq!(result.rows.len(), 1);
        request.left.source.filter = Some("a < 100".into());
        request.right.source.filter = Some("a < 100".into());
        assert_eq!(compare(&request).await.unwrap().counts.equal, 99);
        let result = execution::with_progress(
            |_| {
                execution::cancel("compare-cancel").unwrap();
            },
            execution::run(
                Some(execution::ExecutionOptions {
                    job_id: Some("compare-cancel".into()),
                    ..Default::default()
                }),
                true,
                compare(&request),
            ),
        )
        .await;
        assert!(result.is_err());
        client
            .batch_execute("DROP TABLE compare_left, compare_right")
            .await
            .unwrap();
    }
}
