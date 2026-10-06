use serde_json::{json, Map, Value};

use crate::db::DatabaseKind;

const BUCKETS: &[&str] = &["none", "day", "week", "month", "quarter", "year"];
const AGGS: &[&str] = &[
    "count",
    "count_distinct",
    "sum",
    "avg",
    "min",
    "max",
    "none",
];
const OPERATORS: &[&str] = &[
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "startsWith",
    "endsWith",
    "in",
    "notIn",
    "isNull",
    "isNotNull",
];
const VARIABLE_TYPES: &[&str] = &["text", "number", "date", "select"];
const JOIN_PREFIX: &str = "join:";
const CALC_PREFIX: &str = "calc:";
const MAX_JOINS: usize = 12;
const MAX_FIELDS: usize = 30;

pub(super) fn new_short_id(seed: &str, index: usize) -> String {
    let clean: String = seed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect();
    format!("{}{index}", if clean.is_empty() { "f" } else { &clean })
}

fn style_quote(kind: DatabaseKind, name: &str) -> String {
    match kind {
        DatabaseKind::Mysql | DatabaseKind::Bigquery => format!("`{}`", name.replace('`', "``")),
        DatabaseKind::Mssql => format!("[{}]", name.replace(']', "]]")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

pub(super) fn quote_string(value: &str, kind: DatabaseKind) -> String {
    if kind == DatabaseKind::Mysql && value.contains('\\') {
        let parts: Vec<String> = value
            .split('\\')
            .map(|part| quote_string(part, kind))
            .collect();
        return format!("CONCAT({})", parts.join(", CHAR(92 USING utf8mb4), "));
    }
    let postgres_escape = kind == DatabaseKind::Postgres && value.contains('\\');
    let escaped =
        if matches!(kind, DatabaseKind::Clickhouse | DatabaseKind::Snowflake) || postgres_escape {
            value.replace('\\', "\\\\")
        } else {
            value.to_string()
        };
    let prefix = if kind == DatabaseKind::Mssql {
        "N"
    } else if postgres_escape {
        "E"
    } else {
        ""
    };
    format!("{prefix}'{}'", escaped.replace('\'', "''"))
}

fn is_number(value: &str) -> bool {
    let trimmed = value.trim();
    let body = trimmed.strip_prefix('-').unwrap_or(trimmed);
    let mut parts = body.splitn(2, '.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next();
    !whole.is_empty()
        && whole.chars().all(|c| c.is_ascii_digit())
        && fraction.is_none_or(|f| !f.is_empty() && f.chars().all(|c| c.is_ascii_digit()))
}

fn literal(value: &str, kind: DatabaseKind) -> String {
    let strict = matches!(kind, DatabaseKind::Oracle | DatabaseKind::Mssql);
    let trimmed = value.trim();
    if !strict && (is_number(trimmed) || trimmed == "true" || trimmed == "false") {
        return trimmed.to_string();
    }
    quote_string(value, kind)
}

fn token_name(raw: &str) -> Option<&str> {
    let inner = raw.trim().strip_prefix("{{")?.strip_suffix("}}")?.trim();
    let mut chars = inner.chars();
    let first = chars.next()?;
    ((first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_'))
    .then_some(inner)
}

pub(super) fn variable_value(
    variables: &[Value],
    values: &Map<String, Value>,
    name: &str,
) -> Option<String> {
    let variable = variables.iter().find(|v| v["name"] == name)?;
    Some(
        values
            .get(name)
            .and_then(|v| match v {
                Value::String(s) => Some(s.clone()),
                Value::Number(n) => Some(n.to_string()),
                Value::Null => Some(String::new()),
                _ => None,
            })
            .unwrap_or_else(|| variable["defaultValue"].as_str().unwrap_or("").to_string()),
    )
}

fn variable_literal(variable: &Value, value: &str, kind: DatabaseKind) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "NULL".into();
    }
    match variable["type"].as_str().unwrap_or("text") {
        "number" if is_number(trimmed) => trimmed.to_string(),
        "number" => "NULL".into(),
        "date" => {
            let valid = trimmed.len() == 10
                && trimmed.chars().enumerate().all(|(i, c)| {
                    if i == 4 || i == 7 {
                        c == '-'
                    } else {
                        c.is_ascii_digit()
                    }
                });
            match (valid, kind) {
                (false, _) => "NULL".into(),
                (true, DatabaseKind::Oracle) => format!("DATE '{trimmed}'"),
                (true, _) => format!("'{trimmed}'"),
            }
        }
        _ => quote_string(trimmed, kind),
    }
}

pub(super) fn substitute(
    sql: &str,
    variables: &[Value],
    values: &Map<String, Value>,
    kind: DatabaseKind,
) -> String {
    if !sql.contains("{{") {
        return sql.to_string();
    }
    let mut out = String::with_capacity(sql.len());
    let mut rest = sql;
    while let Some(start) = rest.find(['{', '\'', '"']) {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let quote = after.as_bytes()[0];
        if quote != b'{' {
            let len = quoted_len(after, quote);
            out.push_str(&after[..len]);
            rest = &after[len..];
            continue;
        }
        let end = match after.strip_prefix("{{").and(after.find("}}")) {
            Some(end) => end,
            None => {
                out.push('{');
                rest = &after[1..];
                continue;
            }
        };
        let token = &after[..end + 2];
        match token_name(token).and_then(|name| {
            let variable = variables.iter().find(|v| v["name"] == name)?;
            let value = variable_value(variables, values, name).unwrap_or_default();
            Some(variable_literal(variable, &value, kind))
        }) {
            Some(replacement) => out.push_str(&replacement),
            None => out.push_str(token),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

fn quoted_len(text: &str, quote: u8) -> usize {
    let bytes = text.as_bytes();
    let mut i = 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
        } else if bytes[i] == quote {
            if bytes.get(i + 1) == Some(&quote) {
                i += 2;
            } else {
                return i + 1;
            }
        } else {
            i += 1;
        }
    }
    text.len()
}

pub(super) fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start..];
        let Some(end) = after.find("}}") else { break };
        if let Some(name) = token_name(&after[..end + 2]) {
            if !out.iter().any(|n| n == name) {
                out.push(name.to_string());
            }
        }
        rest = &after[end + 2..];
    }
    out
}

pub(super) fn parse_variables(value: &Value) -> Result<Vec<Value>, String> {
    let list = match value {
        Value::Null => return Ok(Vec::new()),
        Value::Array(list) => list,
        _ => return Err("variables muss eine Liste sein.".into()),
    };
    let mut out: Vec<Value> = Vec::new();
    for (index, item) in list.iter().enumerate() {
        let name = item["name"].as_str().unwrap_or("").trim();
        let valid = name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            && name.len() <= 40;
        if !valid {
            return Err(format!(
                "variables[{index}].name '{name}' ungültig: Buchstaben, Ziffern, _ (z. B. mandant)."
            ));
        }
        if out.iter().any(|v| v["name"] == name) {
            return Err(format!("variable '{name}' doppelt."));
        }
        let kind = item["type"].as_str().unwrap_or("text");
        if !VARIABLE_TYPES.contains(&kind) {
            return Err(format!(
                "variables[{index}].type '{kind}' unbekannt. Möglich: {}",
                VARIABLE_TYPES.join(", ")
            ));
        }
        let default = match item.get("default").or_else(|| item.get("defaultValue")) {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            Some(_) => {
                return Err(format!(
                    "variables[{index}].default muss Text oder Zahl sein."
                ))
            }
        };
        let mut variable = json!({
            "id": item["id"].as_str().map(str::to_string).unwrap_or_else(|| format!("v-{name}")),
            "name": name,
            "label": item["label"].as_str().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(name),
            "type": kind,
            "defaultValue": default,
        });
        if kind == "select" {
            if let Some(options) = item["options"].as_array() {
                variable["options"] = json!(options
                    .iter()
                    .filter_map(|o| match o {
                        Value::String(s) => Some(s.clone()),
                        Value::Number(n) => Some(n.to_string()),
                        _ => None,
                    })
                    .collect::<Vec<_>>());
            }
            if let Some(sql) = item["optionsSql"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                variable["optionsSql"] = json!(sql);
            }
            if variable.get("options").is_none() && variable.get("optionsSql").is_none() {
                return Err(format!(
                    "variable '{name}' (select) braucht options oder optionsSql."
                ));
            }
        }
        out.push(variable);
    }
    Ok(out)
}

pub(super) fn join_id(parent: Option<&str>, join: &Value) -> String {
    format!(
        "{}{}.{}.{}.{}",
        parent.map(|p| format!("{p}>")).unwrap_or_default(),
        join["schema"].as_str().unwrap_or(""),
        join["table"].as_str().unwrap_or(""),
        join["fromColumn"].as_str().unwrap_or(""),
        join["toColumn"].as_str().unwrap_or("")
    )
    .replace(':', "_")
}

struct Alias {
    name: String,
    id: Option<String>,
}

struct Scope {
    aliases: Vec<Alias>,
    fields: Vec<(String, String)>,
}

impl Scope {
    fn resolve(&self, raw: &str) -> Result<String, String> {
        let name = raw.trim();
        if name.is_empty() {
            return Err("Feldname fehlt.".into());
        }
        if let Some((_, id)) = self
            .fields
            .iter()
            .find(|(label, _)| label.eq_ignore_ascii_case(name))
        {
            return Ok(format!("{CALC_PREFIX}{id}"));
        }
        if let Some((prefix, column)) = name.split_once('.') {
            if let Some(alias) = self
                .aliases
                .iter()
                .find(|a| a.name.eq_ignore_ascii_case(prefix))
            {
                return Ok(match &alias.id {
                    Some(id) => format!("{JOIN_PREFIX}{id}:{column}"),
                    None => column.to_string(),
                });
            }
        }
        Ok(name.to_string())
    }
}

fn split_identifier(text: &str) -> bool {
    let mut parts = text.split('.');
    let ok = |p: &str| {
        let mut chars = p.chars();
        chars.next().is_some_and(|c| c.is_alphabetic() || c == '_')
            && chars.all(|c| c.is_alphanumeric() || c == '_')
    };
    let first = parts.next().is_some_and(ok);
    let second = parts.next().is_none_or(ok);
    first && second && parts.next().is_none()
}

fn expr_to_tokens(expr: &str, scope: &Scope) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = expr;
    while let Some(start) = rest.find('[') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find(']') else {
            out.push_str(&rest[start..]);
            return Ok(out);
        };
        let inner = after[..end].trim();
        if after.starts_with('[') {
            let closing = after.find("]]").map_or(end, |e| e + 1);
            out.push_str(&rest[start..start + 1 + closing + 1]);
            rest = &after[closing + 1..];
            continue;
        }
        if split_identifier(inner) {
            out.push_str(&format!("[[{}]]", scope.resolve(inner)?));
        } else {
            out.push('[');
            out.push_str(&after[..end]);
            out.push(']');
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn looks_aggregate(expr: &str) -> bool {
    let lower = expr.to_lowercase();
    [
        "sum(",
        "avg(",
        "count(",
        "min(",
        "max(",
        "uniq",
        "any(",
        "argmax(",
        "argmin(",
        "median(",
        "quantile",
        "stddev",
        "grouparray(",
        "sumif(",
        "countif(",
        "avgif(",
    ]
    .iter()
    .any(|f| {
        lower.match_indices(f).any(|(i, _)| {
            i == 0
                || !lower[..i]
                    .chars()
                    .last()
                    .is_some_and(|c| c.is_alphanumeric() || c == '_')
        })
    })
}

fn pairs_of(value: &Value) -> Result<Vec<(String, String)>, String> {
    let strip = |s: &str| s.trim().rsplit('.').next().unwrap_or("").trim().to_string();
    match value {
        Value::String(text) => {
            let mut out = Vec::new();
            let lower = text.to_ascii_lowercase();
            let mut start = 0;
            let mut cuts = Vec::new();
            for (i, _) in lower.match_indices(" and ") {
                cuts.push((start, i));
                start = i + 5;
            }
            cuts.push((start, text.len()));
            for (a, b) in cuts {
                let part = &text[a..b];
                let (left, right) = part
                    .split_once('=')
                    .ok_or_else(|| format!("join on '{part}': Form 'spalte = spalte' erwartet."))?;
                out.push((strip(left), strip(right)));
            }
            Ok(out)
        }
        Value::Array(list) => list
            .iter()
            .map(|pair| match pair {
                Value::Array(two) if two.len() == 2 => Ok((
                    strip(two[0].as_str().unwrap_or("")),
                    strip(two[1].as_str().unwrap_or("")),
                )),
                Value::Object(map) => Ok((
                    strip(map.get("from").and_then(Value::as_str).unwrap_or("")),
                    strip(map.get("to").and_then(Value::as_str).unwrap_or("")),
                )),
                _ => Err("join on: Liste aus [von, nach] erwartet.".into()),
            })
            .collect(),
        _ => Err("join on fehlt: 'artikel_id = id' oder [[\"artikel_id\",\"id\"]].".into()),
    }
}

fn split_table(raw: &str, schema: Option<&str>) -> (String, String) {
    let raw = raw.trim();
    match (schema, raw.split_once('.')) {
        (Some(s), _) if !s.trim().is_empty() => (s.trim().to_string(), raw.to_string()),
        (_, Some((s, t))) => (s.to_string(), t.to_string()),
        _ => (String::new(), raw.to_string()),
    }
}

fn metric_of(value: &Value, scope: &Scope, index: usize) -> Result<Value, String> {
    let (agg, field, label) = match value {
        Value::String(text) => {
            let text = text.trim();
            let lower = text.to_ascii_lowercase();
            if lower == "count" || lower == "count(*)" {
                ("count".to_string(), None, String::new())
            } else if let Some(open) = text.find('(').filter(|_| text.ends_with(')')) {
                let name = text[..open]
                    .trim()
                    .to_lowercase()
                    .replace("countdistinct", "count_distinct");
                let inner = text[open + 1..text.len() - 1].trim();
                let agg = if name == "count" && inner.to_lowercase().starts_with("distinct ") {
                    "count_distinct".to_string()
                } else {
                    name
                };
                let inner = inner
                    .strip_prefix("distinct ")
                    .or_else(|| inner.strip_prefix("DISTINCT "))
                    .unwrap_or(inner);
                (
                    agg,
                    (inner != "*").then(|| inner.to_string()),
                    String::new(),
                )
            } else {
                ("auto".to_string(), Some(text.to_string()), String::new())
            }
        }
        Value::Object(map) => (
            map.get("agg")
                .and_then(Value::as_str)
                .unwrap_or("auto")
                .to_lowercase(),
            map.get("field")
                .or_else(|| map.get("column"))
                .and_then(Value::as_str)
                .map(str::to_string),
            map.get("label")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        ),
        _ => return Err(format!("metrics[{index}] muss Text oder Objekt sein.")),
    };
    let column = field.map(|f| scope.resolve(&f)).transpose()?;
    let agg = match agg.as_str() {
        "auto" => "none".to_string(),
        "distinct" | "uniq" | "count_distinct" => "count_distinct".to_string(),
        "average" | "mean" => "avg".to_string(),
        other => other.to_string(),
    };
    if !AGGS.contains(&agg.as_str()) {
        return Err(format!(
            "metrics[{index}]: Aggregation '{agg}' unbekannt. Möglich: {}",
            AGGS.join(", ")
        ));
    }
    if column.is_none() && agg != "count" {
        return Err(format!("metrics[{index}]: Feld fehlt."));
    }
    Ok(json!({"id": format!("m{index}"), "agg": agg, "column": column, "label": label}))
}

pub(super) fn parse_builder(spec: &Value) -> Result<Value, String> {
    let spec = spec.as_object().ok_or("builder muss ein Objekt sein.")?;
    let table = spec
        .get("table")
        .and_then(Value::as_str)
        .filter(|t| !t.trim().is_empty())
        .ok_or("builder.table fehlt.")?;
    let (schema, table) = split_table(table, spec.get("schema").and_then(Value::as_str));
    let mut scope = Scope {
        aliases: vec![Alias {
            name: table.clone(),
            id: None,
        }],
        fields: Vec::new(),
    };
    let mut joins: Vec<Value> = Vec::new();
    let raw_joins = spec
        .get("joins")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if raw_joins.len() > MAX_JOINS {
        return Err(format!("Höchstens {MAX_JOINS} joins."));
    }
    for (index, raw) in raw_joins.iter().enumerate() {
        let name = raw["table"]
            .as_str()
            .filter(|t| !t.trim().is_empty())
            .ok_or(format!("joins[{index}].table fehlt."))?;
        let (jschema, jtable) = split_table(
            name,
            raw["schema"]
                .as_str()
                .or(Some(schema.as_str()))
                .filter(|s| !s.is_empty()),
        );
        let parent = match raw["from"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => None,
            Some(from) => {
                let alias = scope
                    .aliases
                    .iter()
                    .find(|a| a.name.eq_ignore_ascii_case(from))
                    .ok_or(format!(
                        "joins[{index}].from '{from}' ist keine vorherige Tabelle."
                    ))?;
                alias.id.clone()
            }
        };
        let pairs = pairs_of(raw.get("on").unwrap_or(&Value::Null))?;
        let Some((first, rest)) = pairs.split_first() else {
            return Err(format!("joins[{index}].on ist leer."));
        };
        if pairs.iter().any(|(a, b)| a.is_empty() || b.is_empty()) {
            return Err(format!("joins[{index}].on enthält eine leere Spalte."));
        }
        let kind = match raw["kind"]
            .as_str()
            .or(raw["type"].as_str())
            .unwrap_or("left")
            .to_lowercase()
            .as_str()
        {
            "left" | "left join" => "left",
            "inner" | "inner join" | "join" => "inner",
            other => return Err(format!("joins[{index}].kind '{other}': left oder inner.")),
        };
        let mut join = json!({
            "schema": jschema,
            "table": jtable,
            "fromColumn": first.0,
            "toColumn": first.1,
            "kind": kind,
            "manual": true,
            "parent": parent,
        });
        if !rest.is_empty() {
            join["extra"] = json!(rest
                .iter()
                .map(|(a, b)| json!({"from": a, "to": b}))
                .collect::<Vec<_>>());
        }
        let id = join_id(parent.as_deref(), &join);
        if joins.iter().any(|j| j["id"] == id) {
            return Err(format!("joins[{index}] ist doppelt."));
        }
        join["id"] = json!(id);
        let alias = raw["as"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let taken = scope
                    .aliases
                    .iter()
                    .filter(|a| a.name == jtable || a.name.starts_with(&format!("{jtable}_")))
                    .count();
                if taken == 0 {
                    jtable.clone()
                } else {
                    format!("{jtable}_{}", taken + 1)
                }
            });
        if scope
            .aliases
            .iter()
            .any(|a| a.name.eq_ignore_ascii_case(&alias))
        {
            return Err(format!(
                "joins[{index}]: Alias '{alias}' doppelt, 'as' setzen."
            ));
        }
        scope.aliases.push(Alias {
            name: alias,
            id: Some(id),
        });
        joins.push(join);
    }
    let raw_fields = spec
        .get("fields")
        .or_else(|| spec.get("calculated"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if raw_fields.len() > MAX_FIELDS {
        return Err(format!("Höchstens {MAX_FIELDS} fields."));
    }
    for (index, raw) in raw_fields.iter().enumerate() {
        let label = raw["name"]
            .as_str()
            .or(raw["label"].as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or(format!("fields[{index}].name fehlt."))?;
        scope
            .fields
            .push((label.to_string(), new_short_id(label, index)));
    }
    let mut calculated = Vec::new();
    for (index, raw) in raw_fields.iter().enumerate() {
        let expr = raw["expr"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or(format!("fields[{index}].expr fehlt."))?;
        let tokens = expr_to_tokens(expr, &scope)?;
        let (label, id) = scope.fields[index].clone();
        let field_type = raw["type"].as_str().unwrap_or("number");
        if !["number", "text", "date"].contains(&field_type) {
            return Err(format!("fields[{index}].type: number, text oder date."));
        }
        calculated.push(json!({
            "id": id,
            "label": label,
            "expr": tokens,
            "aggregate": raw["aggregate"].as_bool().unwrap_or_else(|| looks_aggregate(expr)),
            "type": field_type,
        }));
    }
    let dimension = match spec.get("dimension") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::String(name)) => json!({"column": scope.resolve(name)?, "bucket": "none"}),
        Some(Value::Object(map)) => {
            let field = map
                .get("field")
                .or_else(|| map.get("column"))
                .and_then(Value::as_str)
                .ok_or("dimension.field fehlt.")?;
            let bucket = map.get("bucket").and_then(Value::as_str).unwrap_or("none");
            if !BUCKETS.contains(&bucket) {
                return Err(format!(
                    "dimension.bucket '{bucket}' unbekannt. Möglich: {}",
                    BUCKETS.join(", ")
                ));
            }
            json!({"column": scope.resolve(field)?, "bucket": bucket})
        }
        Some(_) => return Err("dimension muss Feldname oder {field, bucket} sein.".into()),
    };
    let field = |key: &str| -> Result<Value, String> {
        match spec
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(name) => Ok(json!(scope.resolve(name)?)),
            None => Ok(Value::Null),
        }
    };
    let dimension2 = field("dimension2")?;
    let date_column = field("dateColumn")?;
    let metrics = match spec.get("metrics") {
        None | Some(Value::Null) => {
            vec![json!({"id": "m0", "agg": "count", "column": null, "label": "Anzahl"})]
        }
        Some(Value::Array(list)) if !list.is_empty() => list
            .iter()
            .enumerate()
            .map(|(i, m)| metric_of(m, &scope, i))
            .collect::<Result<Vec<_>, _>>()?,
        Some(value @ Value::String(_)) => vec![metric_of(value, &scope, 0)?],
        Some(_) => return Err("metrics muss eine nicht-leere Liste sein.".into()),
    };
    let filters = spec
        .get("filters")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            let name = raw["field"].as_str().or(raw["column"].as_str()).ok_or(format!("filters[{index}].field fehlt."))?;
            let op = raw["op"].as_str().or(raw["operator"].as_str()).unwrap_or("eq");
            let op = match op {
                "=" | "==" => "eq",
                "!=" | "<>" => "neq",
                ">" => "gt",
                ">=" => "gte",
                "<" => "lt",
                "<=" => "lte",
                other => other,
            };
            if !OPERATORS.contains(&op) {
                return Err(format!("filters[{index}].op '{op}' unbekannt. Möglich: {}", OPERATORS.join(", ")));
            }
            let value = match raw.get("value") {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                Some(Value::Bool(b)) => b.to_string(),
                Some(Value::Array(list)) => serde_json::to_string(
                    &list.iter().map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).collect::<Vec<_>>(),
                ).unwrap_or_default(),
                Some(_) => return Err(format!("filters[{index}].value ungültig.")),
            };
            Ok(json!({"id": format!("f{index}"), "column": scope.resolve(name)?, "operator": op, "value": value}))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let sort = spec
        .get("sort")
        .and_then(Value::as_str)
        .unwrap_or("dimension");
    if !["dimension", "metric_desc", "metric_asc"].contains(&sort) {
        return Err("sort: dimension, metric_desc oder metric_asc.".into());
    }
    let limit = spec
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 5000);
    Ok(json!({
        "schema": schema,
        "table": table,
        "join": null,
        "joins": joins,
        "calculated": calculated,
        "dimension": dimension,
        "dimension2": dimension2,
        "metrics": metrics,
        "filters": filters,
        "dateColumn": date_column,
        "sort": sort,
        "limit": limit,
    }))
}

fn joins_of(simple: &Value) -> Vec<Value> {
    simple["joins"].as_array().cloned().unwrap_or_default()
}

fn calc_of<'a>(simple: &'a Value, reference: &str) -> Option<&'a Value> {
    let id = reference.strip_prefix(CALC_PREFIX)?;
    simple["calculated"]
        .as_array()?
        .iter()
        .find(|c| c["id"] == id)
}

fn alias_of(joins: &[Value], id: Option<&str>) -> String {
    match id.and_then(|id| joins.iter().position(|j| j["id"] == id)) {
        Some(index) => format!("t{}", index + 2),
        None => "t1".into(),
    }
}

fn expand_tokens(expr: &str, render: &mut dyn FnMut(&str) -> String) -> String {
    let mut out = String::new();
    let mut rest = expr;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("]]") {
            Some(end) => {
                out.push_str(&render(&after[..end]));
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(&rest[start..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

fn ref_expr(simple: &Value, reference: &str, kind: DatabaseKind, depth: usize) -> String {
    if let Some(calc) = calc_of(simple, reference) {
        if depth > 4 {
            return "NULL".into();
        }
        let expr = calc["expr"].as_str().unwrap_or("").trim();
        let expr = if expr.is_empty() { "NULL" } else { expr };
        return format!(
            "({})",
            expand_tokens(expr, &mut |inner| ref_expr(simple, inner, kind, depth + 1))
        );
    }
    let joins = joins_of(simple);
    let (join, column) = match reference
        .strip_prefix(JOIN_PREFIX)
        .and_then(|rest| rest.split_once(':'))
    {
        Some((id, column)) => (Some(id), column),
        None => (None, reference),
    };
    let name = style_quote(kind, column);
    if joins.is_empty() {
        return name;
    }
    format!("{}.{name}", alias_of(&joins, join))
}

fn bucket_expr(col: &str, bucket: &str, kind: DatabaseKind) -> String {
    if bucket == "none" {
        return col.to_string();
    }
    match kind {
        DatabaseKind::Mysql => match bucket {
            "day" => format!("DATE({col})"),
            "week" => format!("DATE_SUB(DATE({col}), INTERVAL WEEKDAY({col}) DAY)"),
            "month" => format!("DATE_FORMAT({col}, '%Y-%m-01')"),
            "quarter" => format!("CONCAT(YEAR({col}), '-Q', QUARTER({col}))"),
            _ => format!("DATE_FORMAT({col}, '%Y-01-01')"),
        },
        DatabaseKind::Duckdb => format!("date_trunc('{bucket}', {col})"),
        DatabaseKind::Sqlite => match bucket {
            "day" => format!("strftime('%Y-%m-%d', {col})"),
            "week" => format!("strftime('%Y-W%W', {col})"),
            "month" => format!("strftime('%Y-%m', {col})"),
            "quarter" => format!(
                "strftime('%Y', {col}) || '-Q' || ((CAST(strftime('%m', {col}) AS INTEGER) + 2) / 3)"
            ),
            _ => format!("strftime('%Y', {col})"),
        },
        DatabaseKind::Mssql if bucket == "day" => format!("CAST({col} AS date)"),
        DatabaseKind::Mssql => format!("CAST(DATEADD({bucket}, DATEDIFF({bucket}, 0, {col}), 0) AS date)"),
        DatabaseKind::Oracle => {
            let fmt = match bucket {
                "day" => "DD",
                "week" => "IW",
                "month" => "MM",
                "quarter" => "Q",
                _ => "YYYY",
            };
            format!("TRUNC({col}, '{fmt}')")
        }
        _ => format!("date_trunc('{bucket}', {col})"),
    }
}

fn agg_sql(agg: &str, col: &str) -> String {
    match agg {
        "count" => format!("COUNT({col})"),
        "count_distinct" => format!("COUNT(DISTINCT {col})"),
        "none" => col.to_string(),
        other => format!("{}({col})", other.to_uppercase()),
    }
}

fn filter_list(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<Value>>(value)
        .map(|list| {
            list.iter()
                .map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string())
                })
                .collect()
        })
        .unwrap_or_else(|_| {
            value
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
}

fn like(col: &str, pattern: &str, kind: DatabaseKind) -> String {
    format!("LOWER({col}) LIKE LOWER({})", quote_string(pattern, kind))
}

fn condition(col: &str, op: &str, value: &str, kind: DatabaseKind) -> Option<String> {
    let needs_value = !matches!(op, "isNull" | "isNotNull");
    if needs_value && value.trim().is_empty() {
        return None;
    }
    let escaped = value.replace('%', "\\%").replace('_', "\\_");
    Some(match op {
        "eq" => format!("{col} = {}", literal(value, kind)),
        "neq" => format!("{col} <> {}", literal(value, kind)),
        "gt" => format!("{col} > {}", literal(value, kind)),
        "gte" => format!("{col} >= {}", literal(value, kind)),
        "lt" => format!("{col} < {}", literal(value, kind)),
        "lte" => format!("{col} <= {}", literal(value, kind)),
        "contains" => like(col, &format!("%{escaped}%"), kind),
        "startsWith" => like(col, &format!("{escaped}%"), kind),
        "endsWith" => like(col, &format!("%{escaped}"), kind),
        "in" | "notIn" => {
            let values = filter_list(value);
            if values.is_empty() {
                return None;
            }
            let list: Vec<String> = values.iter().map(|v| literal(v, kind)).collect();
            format!(
                "{col} {} ({})",
                if op == "in" { "IN" } else { "NOT IN" },
                list.join(", ")
            )
        }
        "isNull" => format!("{col} IS NULL"),
        "isNotNull" => format!("{col} IS NOT NULL"),
        _ => return None,
    })
}

pub(super) fn builder_sql(
    simple: &Value,
    kind: DatabaseKind,
    variables: &[Value],
    values: &Map<String, Value>,
) -> String {
    let table_name = simple["table"].as_str().unwrap_or("");
    if table_name.is_empty() {
        return String::new();
    }
    let q = |name: &str| style_quote(kind, name);
    let table = |schema: &str, name: &str| {
        if schema.is_empty() {
            q(name)
        } else {
            format!("{}.{}", q(schema), q(name))
        }
    };
    let mut select = Vec::new();
    let mut groups = Vec::new();
    if let Some(column) = simple["dimension"]["column"].as_str() {
        let expr = bucket_expr(
            &ref_expr(simple, column, kind, 0),
            simple["dimension"]["bucket"].as_str().unwrap_or("none"),
            kind,
        );
        select.push(format!("{expr} AS {}", q("dim")));
        groups.push(expr);
    }
    if let Some(column) = simple["dimension2"].as_str() {
        let expr = ref_expr(simple, column, kind, 0);
        select.push(format!("{expr} AS {}", q("dim2")));
        groups.push(expr);
    }
    let metrics: Vec<&Value> = simple["metrics"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter(|m| m["agg"] == "count" || m["column"].as_str().is_some())
                .collect()
        })
        .unwrap_or_default();
    let aggregated_calc = |m: &Value| {
        m["column"]
            .as_str()
            .and_then(|c| calc_of(simple, c))
            .is_some_and(|c| c["aggregate"] == true)
    };
    let metric_expr = |m: &Value| {
        let column = m["column"].as_str();
        if aggregated_calc(m) {
            return ref_expr(simple, column.unwrap_or(""), kind, 0);
        }
        agg_sql(
            m["agg"].as_str().unwrap_or("count"),
            &column.map_or("*".to_string(), |c| ref_expr(simple, c, kind, 0)),
        )
    };
    let summarizes = |m: &Value| m["agg"] != "none" || aggregated_calc(m);
    for (index, metric) in metrics.iter().enumerate() {
        select.push(format!(
            "{} AS {}",
            metric_expr(metric),
            q(&format!("m{index}"))
        ));
    }
    if select.is_empty() {
        select.push("*".into());
    }
    let plain = |m: &Value| !summarizes(m) && m["column"].as_str().is_some();
    let grouped = metrics.iter().any(|m| summarizes(m))
        && (!groups.is_empty() || metrics.iter().any(|m| plain(m)));
    if grouped {
        groups.extend(metrics.iter().filter(|m| plain(m)).map(|m| metric_expr(m)));
    }
    let limit = simple["limit"].as_u64().unwrap_or(50).max(1);
    let mut lines = vec![format!(
        "SELECT {}{}",
        if kind == DatabaseKind::Mssql {
            format!("TOP {limit} ")
        } else {
            String::new()
        },
        select.join(", ")
    )];
    let joins = joins_of(simple);
    let as_kw = if kind == DatabaseKind::Oracle {
        " "
    } else {
        " AS "
    };
    lines.push(format!(
        "FROM {}{}",
        table(simple["schema"].as_str().unwrap_or(""), table_name),
        if joins.is_empty() {
            String::new()
        } else {
            format!("{as_kw}t1")
        }
    ));
    for join in &joins {
        let alias = alias_of(&joins, join["id"].as_str());
        let parent = alias_of(&joins, join["parent"].as_str());
        let mut pairs = vec![(
            join["fromColumn"].as_str().unwrap_or("").to_string(),
            join["toColumn"].as_str().unwrap_or("").to_string(),
        )];
        for extra in join["extra"].as_array().into_iter().flatten() {
            pairs.push((
                extra["from"].as_str().unwrap_or("").to_string(),
                extra["to"].as_str().unwrap_or("").to_string(),
            ));
        }
        let on: Vec<String> = pairs
            .iter()
            .filter(|(a, b)| !a.is_empty() && !b.is_empty())
            .map(|(from, to)| format!("{alias}.{} = {parent}.{}", q(to), q(from)))
            .collect();
        lines.push(format!(
            "{} JOIN {}{as_kw}{alias} ON {}",
            if join["kind"] == "inner" {
                "INNER"
            } else {
                "LEFT"
            },
            table(
                join["schema"].as_str().unwrap_or(""),
                join["table"].as_str().unwrap_or("")
            ),
            on.join(" AND ")
        ));
    }
    let wheres: Vec<String> = simple["filters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|filter| {
            let column = filter["column"].as_str()?;
            let raw = filter["value"].as_str().unwrap_or("");
            let value = match token_name(raw) {
                Some(name) => {
                    let value = variable_value(variables, values, name)?;
                    if value.trim().is_empty() {
                        return None;
                    }
                    value
                }
                None => raw.to_string(),
            };
            condition(
                &ref_expr(simple, column, kind, 0),
                filter["operator"].as_str().unwrap_or("eq"),
                &value,
                kind,
            )
        })
        .collect();
    if !wheres.is_empty() {
        lines.push(format!("WHERE {}", wheres.join(" AND ")));
    }
    if grouped {
        lines.push(format!("GROUP BY {}", groups.join(", ")));
    }
    let sort = simple["sort"].as_str().unwrap_or("dimension");
    let order = if sort == "dimension" {
        (simple["dimension"].is_object() && grouped).then(|| q("dim"))
    } else {
        (!metrics.is_empty()).then(|| q("m0"))
    };
    if let Some(target) = order {
        lines.push(format!(
            "ORDER BY {target} {}",
            if sort == "metric_desc" { "DESC" } else { "ASC" }
        ));
    }
    match kind {
        DatabaseKind::Oracle => lines.push(format!("FETCH FIRST {limit} ROWS ONLY")),
        DatabaseKind::Mssql => {}
        _ => lines.push(format!("LIMIT {limit}")),
    }
    substitute(&lines.join("\n"), variables, values, kind)
}

pub(super) fn describe_builder(simple: &Value) -> Value {
    let joins = joins_of(simple);
    let base = simple["table"].as_str().unwrap_or("").to_string();
    let mut aliases: Vec<(String, String)> = Vec::new();
    for join in &joins {
        let table = join["table"].as_str().unwrap_or("").to_string();
        let taken = aliases
            .iter()
            .filter(|(_, a)| *a == table || a.starts_with(&format!("{table}_")))
            .count()
            + usize::from(table == base);
        let alias = if taken == 0 {
            table
        } else {
            format!("{table}_{}", taken + 1)
        };
        aliases.push((join["id"].as_str().unwrap_or("").to_string(), alias));
    }
    let name_of = |reference: &str| -> String {
        if let Some(calc) = calc_of(simple, reference) {
            return calc["label"].as_str().unwrap_or("").to_string();
        }
        match reference
            .strip_prefix(JOIN_PREFIX)
            .and_then(|r| r.split_once(':'))
        {
            Some((id, column)) => {
                let alias = aliases
                    .iter()
                    .find(|(j, _)| j == id)
                    .map_or(id, |(_, a)| a.as_str());
                format!("{alias}.{column}")
            }
            None => reference.to_string(),
        }
    };
    let joins_out: Vec<Value> = joins
        .iter()
        .zip(&aliases)
        .map(|(join, (_, alias))| {
            let mut on = vec![format!(
                "{} = {}",
                join["fromColumn"].as_str().unwrap_or(""),
                join["toColumn"].as_str().unwrap_or("")
            )];
            for extra in join["extra"].as_array().into_iter().flatten() {
                on.push(format!(
                    "{} = {}",
                    extra["from"].as_str().unwrap_or(""),
                    extra["to"].as_str().unwrap_or("")
                ));
            }
            let mut out = json!({
                "table": join["table"],
                "as": alias,
                "on": on.join(" AND "),
                "kind": join["kind"].as_str().unwrap_or("left"),
            });
            if let Some(parent) = join["parent"].as_str() {
                out["from"] = json!(aliases
                    .iter()
                    .find(|(id, _)| id == parent)
                    .map_or(parent, |(_, a)| a.as_str()));
            }
            if !join["schema"].as_str().unwrap_or("").is_empty() {
                out["schema"] = join["schema"].clone();
            }
            out
        })
        .collect();
    let fields: Vec<Value> = simple["calculated"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            json!({
                "name": c["label"],
                "expr": expand_tokens(c["expr"].as_str().unwrap_or(""), &mut |r| format!("[{}]", name_of(r))),
                "aggregate": c["aggregate"],
                "type": c["type"].as_str().unwrap_or("number"),
            })
        })
        .collect();
    let metrics: Vec<Value> = simple["metrics"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|m| {
            let mut out = json!({"agg": m["agg"]});
            if let Some(column) = m["column"].as_str() {
                out["field"] = json!(name_of(column));
            }
            if let Some(label) = m["label"].as_str().filter(|l| !l.is_empty()) {
                out["label"] = json!(label);
            }
            out
        })
        .collect();
    let filters: Vec<Value> = simple["filters"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| {
            json!({
                "field": name_of(f["column"].as_str().unwrap_or("")),
                "op": f["operator"],
                "value": f["value"],
            })
        })
        .collect();
    let mut out = json!({
        "table": base,
        "metrics": metrics,
        "sort": simple["sort"],
        "limit": simple["limit"],
    });
    if !simple["schema"].as_str().unwrap_or("").is_empty() {
        out["schema"] = simple["schema"].clone();
    }
    if !joins_out.is_empty() {
        out["joins"] = json!(joins_out);
    }
    if !fields.is_empty() {
        out["fields"] = json!(fields);
    }
    if let Some(column) = simple["dimension"]["column"].as_str() {
        out["dimension"] =
            json!({"field": name_of(column), "bucket": simple["dimension"]["bucket"]});
    }
    if let Some(column) = simple["dimension2"].as_str() {
        out["dimension2"] = json!(name_of(column));
    }
    if let Some(column) = simple["dateColumn"].as_str() {
        out["dateColumn"] = json!(name_of(column));
    }
    if !filters.is_empty() {
        out["filters"] = json!(filters);
    }
    out
}

pub(super) fn dataset_variables(dataset: &Value) -> Vec<String> {
    let mut names = Vec::new();
    let mut add = |text: &str| {
        for name in tokens(text) {
            if !names.contains(&name) {
                names.push(name);
            }
        }
    };
    add(dataset["sql"].as_str().unwrap_or(""));
    for filter in dataset["simple"]["filters"]
        .as_array()
        .into_iter()
        .flatten()
    {
        add(filter["value"].as_str().unwrap_or(""));
    }
    for field in dataset["simple"]["calculated"]
        .as_array()
        .into_iter()
        .flatten()
    {
        add(field["expr"].as_str().unwrap_or(""));
    }
    names
}
