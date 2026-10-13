use super::config::{McpConfig, McpConnection};
use super::redact::{self, Redactor};
use super::server::{adapter, arg_str, check_read_sql, run, Server};
use crate::db::{DatabaseKind, QueryResult};
use serde_json::{json, Value};

const MAX_DIMENSIONS: usize = 8;
const SHOWN_DIMENSIONS: usize = 5;
const SHOWN_SEGMENTS: usize = 5;
const EXPLAIN_TARGET: f64 = 0.67;
const MIN_SHARE: f64 = 0.1;

pub fn tool_definition() -> Value {
    json!({
        "name": "drilldown",
        "description": "Root-cause analysis: explain why a metric changed between two periods. Splits the change by every given dimension in one GROUP BY per dimension, ranks dimensions with the Adtributor method (explanatory power and surprise) and drills one level deeper into the strongest segment. Use it for why questions about drops, spikes or differences instead of guessing breakdowns by hand. Only additive metrics (sums and counts).",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "from": {"type": "string", "description": "FROM clause body without the word FROM, joins allowed, e.g. sales.orders o JOIN sales.customers c ON c.id = o.customer_id"},
            "value": {"type": "string", "description": "Additive value expression per row, e.g. o.total. Default 1 (row count)"},
            "current": {"type": "string", "description": "SQL condition selecting rows of the period to explain, e.g. o.created_at >= DATE '2026-10-12'"},
            "baseline": {"type": "string", "description": "SQL condition selecting the comparison rows"},
            "dimensions": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": MAX_DIMENSIONS, "description": "Column expressions to split by, e.g. c.country, o.channel. Prefer low-cardinality columns"},
            "filter": {"type": "string", "description": "Optional extra condition for both periods"},
            "depth": {"type": "integer", "minimum": 1, "maximum": 2, "description": "2 (default) also drills into the strongest segment"}
        }, "required": ["connection", "from", "current", "baseline", "dimensions"]}
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub label: String,
    pub raw: Value,
    pub baseline: f64,
    pub current: f64,
}

#[derive(Debug)]
pub struct Ranked {
    pub surprise: f64,
    pub explained: f64,
    pub segments: Vec<(Segment, f64, f64)>,
}

fn entropy_part(p: f64, q: f64) -> f64 {
    if p <= 0.0 {
        return 0.0;
    }
    p * (2.0 * p / (p + q)).log2()
}

pub fn rank(segments: &[Segment], base: f64, current: f64) -> Ranked {
    let delta = current - base;
    let mut scored: Vec<(Segment, f64, f64)> = segments
        .iter()
        .map(|segment| {
            let share = if delta == 0.0 {
                0.0
            } else {
                (segment.current - segment.baseline) / delta
            };
            let p = if base == 0.0 {
                0.0
            } else {
                segment.baseline / base
            };
            let q = if current == 0.0 {
                0.0
            } else {
                segment.current / current
            };
            let surprise = 0.5 * (entropy_part(p, q) + entropy_part(q, p));
            (segment.clone(), share, surprise)
        })
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut explained = 0.0;
    let mut surprise = 0.0;
    let mut picked = Vec::new();
    for entry in &scored {
        if entry.1 < MIN_SHARE || explained >= EXPLAIN_TARGET {
            break;
        }
        explained += entry.1;
        surprise += entry.2;
        picked.push(entry.clone());
    }
    if picked.is_empty() {
        picked = scored.into_iter().take(SHOWN_SEGMENTS).collect();
    }
    Ranked {
        surprise,
        explained,
        segments: picked,
    }
}

fn number(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(0.0),
        Value::String(text) => text.trim().parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn cell(result: &QueryResult, row: &Value, index: usize) -> Value {
    match row {
        Value::Array(list) => list.get(index).cloned().unwrap_or(Value::Null),
        Value::Object(map) => result
            .columns
            .get(index)
            .and_then(|column| map.get(column))
            .cloned()
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn label(value: &Value) -> String {
    match value {
        Value::Null => "(leer)".into(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

pub fn segments(result: &QueryResult) -> Vec<Segment> {
    result
        .rows
        .iter()
        .map(|row| {
            let raw = cell(result, row, 0);
            Segment {
                label: label(&raw),
                baseline: number(&cell(result, row, 2)),
                current: number(&cell(result, row, 1)),
                raw,
            }
        })
        .collect()
}

pub fn literal(value: &Value, kind: DatabaseKind) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) if matches!(kind, DatabaseKind::Mssql | DatabaseKind::Oracle) => {
            Some(if *flag { "1" } else { "0" }.into())
        }
        Value::Bool(flag) => Some(if *flag { "TRUE" } else { "FALSE" }.into()),
        Value::String(text) => Some(format!("'{}'", text.replace('\'', "''"))),
        other => Some(format!("'{}'", other.to_string().replace('\'', "''"))),
    }
}

fn condition(current: &str, baseline: &str, filter: &[String]) -> String {
    let mut condition = format!("(({current}) OR ({baseline}))");
    for extra in filter {
        condition.push_str(&format!(" AND ({extra})"));
    }
    condition
}

pub fn totals_sql(
    from: &str,
    value: &str,
    current: &str,
    baseline: &str,
    filter: &[String],
) -> String {
    let condition = condition(current, baseline, filter);
    format!(
        "SELECT SUM(CASE WHEN {current} THEN COALESCE({value}, 0) ELSE 0 END) AS l8db_current, SUM(CASE WHEN {baseline} THEN COALESCE({value}, 0) ELSE 0 END) AS l8db_baseline FROM {from} WHERE {condition}"
    )
}

pub fn breakdown_sql(
    from: &str,
    value: &str,
    current: &str,
    baseline: &str,
    dimension: &str,
    filter: &[String],
) -> String {
    let condition = condition(current, baseline, filter);
    format!(
        "SELECT {dimension} AS l8db_segment, SUM(CASE WHEN {current} THEN COALESCE({value}, 0) ELSE 0 END) AS l8db_current, SUM(CASE WHEN {baseline} THEN COALESCE({value}, 0) ELSE 0 END) AS l8db_baseline FROM {from} WHERE {condition} GROUP BY {dimension} ORDER BY ABS(SUM(CASE WHEN {current} THEN COALESCE({value}, 0) ELSE 0 END) - SUM(CASE WHEN {baseline} THEN COALESCE({value}, 0) ELSE 0 END)) DESC"
    )
}

fn supported(kind: DatabaseKind) -> bool {
    matches!(
        kind,
        DatabaseKind::Postgres
            | DatabaseKind::Mysql
            | DatabaseKind::Sqlite
            | DatabaseKind::SqliteHttp
            | DatabaseKind::Mssql
            | DatabaseKind::Clickhouse
            | DatabaseKind::Oracle
            | DatabaseKind::Duckdb
            | DatabaseKind::Odbc
            | DatabaseKind::Snowflake
            | DatabaseKind::Bigquery
            | DatabaseKind::Athena
    )
}

fn amount(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
    }
}

fn percent(value: f64) -> String {
    format!("{:.0} %", value * 100.0)
}

fn change(base: f64, current: f64) -> String {
    let delta = current - base;
    let sign = if delta >= 0.0 { "+" } else { "" };
    if base == 0.0 {
        format!("{sign}{}", amount(delta))
    } else {
        format!(
            "{sign}{} ({sign}{})",
            amount(delta),
            percent(delta / base.abs())
        )
    }
}

fn column_name(dimension: &str) -> &str {
    dimension
        .rsplit(['.', ' ', '('])
        .find(|part| !part.is_empty())
        .unwrap_or(dimension)
        .trim_matches(['"', '`', ']', '[', ')'])
}

pub fn report(dimension: &str, ranked: &Ranked, redactor: &Redactor, truncated: bool) -> String {
    let mut lines = vec![format!(
        "{dimension}: Überraschung {:.3}, erklärt {}{}",
        ranked.surprise,
        percent(ranked.explained),
        if truncated {
            ", nur die stärksten Segmente gelesen"
        } else {
            ""
        }
    )];
    for (segment, share, _) in ranked.segments.iter().take(SHOWN_SEGMENTS) {
        let shown = redactor.redact_cell(column_name(dimension), &json!(segment.label));
        lines.push(format!(
            "  {} : {} → {}, {}, Anteil an der Veränderung {}",
            label(&shown),
            amount(segment.baseline),
            amount(segment.current),
            change(segment.baseline, segment.current),
            percent(*share)
        ));
    }
    lines.join("\n")
}

struct Request<'a> {
    from: &'a str,
    value: &'a str,
    current: &'a str,
    baseline: &'a str,
}

impl Server {
    pub(super) async fn drilldown(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<String, String> {
        if !supported(connection.kind) {
            return Err("drilldown braucht eine SQL-Datenbank.".into());
        }
        let request = Request {
            from: arg_str(args, "from").trim(),
            value: match arg_str(args, "value").trim() {
                "" => "1",
                value => value,
            },
            current: arg_str(args, "current").trim(),
            baseline: arg_str(args, "baseline").trim(),
        };
        if request.from.is_empty() || request.current.is_empty() || request.baseline.is_empty() {
            return Err("from, current und baseline angeben.".into());
        }
        let dimensions: Vec<String> = args["dimensions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|dimension| !dimension.is_empty())
            .map(String::from)
            .collect();
        if dimensions.is_empty() || dimensions.len() > MAX_DIMENSIONS {
            return Err(format!("1 bis {MAX_DIMENSIONS} dimensions angeben."));
        }
        let mut filter: Vec<String> = match arg_str(args, "filter").trim() {
            "" => Vec::new(),
            extra => vec![extra.to_string()],
        };
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
        let mut levels = Vec::new();
        let ((base_total, current_total), mut first) = self
            .rank_dimensions(config, connection, &index, &request, &dimensions, &filter)
            .await?;
        if base_total == 0.0
            && current_total == 0.0
            && first.iter().all(|(_, _, segments)| segments.is_empty())
        {
            return Ok("Keine Zeilen in beiden Zeiträumen.".into());
        }
        let mut header = format!(
            "Gesamt: {} → {}, {}",
            amount(base_total),
            amount(current_total),
            change(base_total, current_total)
        );
        if base_total == current_total {
            header.push_str("\nKeine Veränderung zu erklären.");
            return Ok(header);
        }
        first.sort_by(|a, b| b.1.surprise.total_cmp(&a.1.surprise));
        let drill = (args["depth"].as_u64().unwrap_or(2) >= 2 && dimensions.len() > 1)
            .then(|| first.first())
            .flatten()
            .and_then(|(dimension, ranked, _)| {
                let (segment, share, _) = ranked.segments.first()?;
                (*share >= MIN_SHARE).then(|| (dimension.clone(), segment.clone()))
            });
        levels.push(
            first
                .iter()
                .take(SHOWN_DIMENSIONS)
                .map(|(dimension, ranked, segments)| {
                    report(
                        dimension,
                        ranked,
                        &redactor,
                        segments.len() >= crate::db::commands::MAX_RESULT_ROWS,
                    )
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
        if let Some((dimension, segment)) = drill {
            let condition = match literal(&segment.raw, connection.kind) {
                Some(value) => format!("{dimension} = {value}"),
                None => format!("{dimension} IS NULL"),
            };
            filter.push(condition);
            let rest: Vec<String> = dimensions
                .iter()
                .filter(|other| **other != dimension)
                .cloned()
                .collect();
            let shown = redactor.redact_cell(column_name(&dimension), &json!(segment.label));
            match self
                .rank_dimensions(config, connection, &index, &request, &rest, &filter)
                .await
            {
                Err(error) => levels.push(format!(
                    "Innerhalb {dimension} = {} nicht weiter zerlegbar: {error}",
                    label(&shown)
                )),
                Ok((_, mut second)) => {
                    second.sort_by(|a, b| b.1.surprise.total_cmp(&a.1.surprise));
                    levels.push(format!(
                        "Innerhalb {dimension} = {}:\n{}",
                        label(&shown),
                        second
                            .iter()
                            .take(SHOWN_DIMENSIONS)
                            .map(|(dimension, ranked, segments)| report(
                                dimension,
                                ranked,
                                &redactor,
                                segments.len() >= crate::db::commands::MAX_RESULT_ROWS
                            ))
                            .collect::<Vec<_>>()
                            .join("\n")
                    ));
                }
            }
        }
        Ok(super::server::cap(
            format!(
                "{header}\nDimensionen nach Erklärungskraft (höhere Überraschung = Veränderung konzentriert sich dort):\n{}",
                levels.join("\n\n")
            ),
            config.max_chars,
        ))
    }

    async fn rank_dimensions(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        index: &redact::SchemaIndex,
        request: &Request<'_>,
        dimensions: &[String],
        filter: &[String],
    ) -> Result<((f64, f64), Vec<(String, Ranked, Vec<Segment>)>), String> {
        let adapter = adapter(connection, &self.pool)?;
        let sql = totals_sql(
            request.from,
            request.value,
            request.current,
            request.baseline,
            filter,
        );
        check_read_sql(&sql, connection, index)?;
        let result = run(config, connection.kind, async {
            adapter.execute_query(&sql).await
        })
        .await?;
        let (base, current) = result
            .rows
            .first()
            .map(|row| {
                (
                    number(&cell(&result, row, 1)),
                    number(&cell(&result, row, 0)),
                )
            })
            .unwrap_or((0.0, 0.0));
        let mut out = Vec::new();
        for dimension in dimensions {
            let sql = breakdown_sql(
                request.from,
                request.value,
                request.current,
                request.baseline,
                dimension,
                filter,
            );
            check_read_sql(&sql, connection, index)?;
            let result = run(config, connection.kind, async {
                adapter.execute_query(&sql).await
            })
            .await
            .map_err(|error| format!("Dimension {dimension}: {error}"))?;
            let segments = segments(&result);
            out.push((dimension.clone(), rank(&segments, base, current), segments));
        }
        Ok(((base, current), out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(label: &str, baseline: f64, current: f64) -> Segment {
        Segment {
            label: label.into(),
            raw: json!(label),
            baseline,
            current,
        }
    }

    fn rank_all(segments: &[Segment]) -> Ranked {
        let base = segments.iter().map(|segment| segment.baseline).sum();
        let current = segments.iter().map(|segment| segment.current).sum();
        rank(segments, base, current)
    }

    #[test]
    fn concentrated_drop_outranks_uniform_drop() {
        let concentrated = rank_all(&[
            segment("DE", 100.0, 10.0),
            segment("AT", 100.0, 100.0),
            segment("CH", 100.0, 100.0),
        ]);
        let uniform = rank_all(&[
            segment("web", 100.0, 70.0),
            segment("app", 100.0, 70.0),
            segment("shop", 100.0, 70.0),
        ]);
        assert!(concentrated.surprise > uniform.surprise * 10.0);
        assert_eq!(concentrated.segments[0].0.label, "DE");
        assert!((concentrated.segments[0].1 - 1.0).abs() < 1e-9);
        assert!(concentrated.explained >= EXPLAIN_TARGET);
    }

    #[test]
    fn builds_portable_breakdown_and_literals() {
        let sql = breakdown_sql(
            "s.orders o",
            "o.total",
            "o.day >= DATE '2026-10-12'",
            "o.day < DATE '2026-10-12'",
            "o.country",
            &["o.country = 'DE'".into()],
        );
        assert!(sql.starts_with("SELECT o.country AS l8db_segment"));
        assert!(sql.contains("GROUP BY o.country ORDER BY ABS("));
        assert!(sql.contains("AND (o.country = 'DE')"));
        assert_eq!(
            literal(&json!("O'Neil"), DatabaseKind::Postgres).unwrap(),
            "'O''Neil'"
        );
        assert_eq!(literal(&json!(5), DatabaseKind::Postgres).unwrap(), "5");
        assert_eq!(literal(&json!(true), DatabaseKind::Mssql).unwrap(), "1");
        assert!(literal(&Value::Null, DatabaseKind::Postgres).is_none());
        assert_eq!(column_name("c.\"country\""), "country");
    }

    #[test]
    fn reads_array_and_object_rows() {
        let result = QueryResult {
            columns: vec![
                "l8db_segment".into(),
                "l8db_current".into(),
                "l8db_baseline".into(),
            ],
            rows: vec![
                json!(["DE", "12.5", 10]),
                json!({"l8db_segment": null, "l8db_current": 1, "l8db_baseline": 2}),
            ],
            rows_affected: None,
            execution_time_ms: 0,
            truncated: false,
        };
        let parsed = segments(&result);
        assert_eq!(parsed[0], segment("DE", 10.0, 12.5));
        assert_eq!(parsed[1].label, "(leer)");
        assert_eq!(parsed[1].baseline, 2.0);
    }

    #[test]
    fn perf_ranking_large_segment_lists_stays_fast_and_bounded() {
        let rows: Vec<Segment> = (0..crate::db::commands::MAX_RESULT_ROWS * 20)
            .map(|index| {
                let base = 100.0 + (index % 97) as f64;
                let current = if index % 50 == 0 { base * 0.2 } else { base };
                segment(&format!("segment-{index}"), base, current)
            })
            .collect();
        let mut timings = Vec::new();
        let mut ranked = None;
        for _ in 0..15 {
            let started = std::time::Instant::now();
            ranked = Some(rank_all(&rows));
            timings.push(started.elapsed());
        }
        timings.sort();
        let median = timings[timings.len() / 2];
        let p95 = timings[timings.len() * 95 / 100];
        assert!(
            median < std::time::Duration::from_millis(60),
            "median {median:?}"
        );
        assert!(p95 < std::time::Duration::from_millis(150), "p95 {p95:?}");
        let ranked = ranked.unwrap();
        let text = report(
            "o.segment",
            &ranked,
            &Redactor::new(&McpConfig::default().redaction, &[]),
            true,
        );
        assert!(text.lines().count() <= SHOWN_SEGMENTS + 1);
        assert!(text.len() < 2_000);
    }

    #[tokio::test]
    async fn sqlite_drilldown_finds_the_concentrated_cause_and_drills_into_it() {
        let mut rows = Vec::new();
        let mut id = 0;
        for period in ["base", "cur"] {
            for country in ["DE", "AT", "CH"] {
                for channel in ["web", "app"] {
                    let count = if period == "cur" && country == "DE" && channel == "app" {
                        2
                    } else {
                        20
                    };
                    for _ in 0..count {
                        id += 1;
                        rows.push(format!("({id}, '{period}', '{country}', '{channel}', 10)"));
                    }
                }
            }
        }
        let (_dir, config, connection, mut server) = super::super::sandbox::sqlite_fixture(&format!(
            "CREATE TABLE orders (id INTEGER PRIMARY KEY, period TEXT, country TEXT, channel TEXT, total REAL);
             INSERT INTO orders VALUES {};",
            rows.join(", ")
        ));
        let started = std::time::Instant::now();
        let text = server
            .drilldown(
                &config,
                &connection,
                &json!({
                    "from": "orders o",
                    "value": "o.total",
                    "current": "o.period = 'cur'",
                    "baseline": "o.period = 'base'",
                    "dimensions": ["o.channel", "o.country"]
                }),
            )
            .await
            .unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        assert!(
            text.starts_with("Gesamt: 1200 → 1020, -180 (-15 %)"),
            "{text}"
        );
        assert!(text.contains("DE : 400 → 220"), "{text}");
        assert!(text.contains("Innerhalb"), "{text}");
        assert!(text.contains("app : 200 → 20"), "{text}");
        let unchanged = server
            .drilldown(
                &config,
                &connection,
                &json!({
                    "from": "orders o",
                    "current": "o.period = 'base'",
                    "baseline": "o.period = 'base'",
                    "dimensions": ["o.country"]
                }),
            )
            .await
            .unwrap();
        assert!(unchanged.contains("Keine Veränderung"), "{unchanged}");
        let write = server
            .drilldown(
                &config,
                &connection,
                &json!({
                    "from": "orders o; DELETE FROM orders",
                    "current": "1 = 1",
                    "baseline": "1 = 0",
                    "dimensions": ["o.country"]
                }),
            )
            .await;
        assert!(write.is_err());
    }
}
