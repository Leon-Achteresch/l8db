use super::{like_pattern, qualified};
use crate::supabase::{
    client, database_execute, database_query, project_api_auth, project_secret_key, project_url,
    quote_identifier, response_json, uses_pg_meta, validate_ref,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const ROW_PAGE: usize = 50;
const TABLE_PAGE: usize = 100;
const MAX_OFFSET: u32 = 1_000_000;
const MAX_FILTERS: usize = 20;
const MAX_IN_VALUES: usize = 100;
const MAX_KEYS: usize = 500;
const MAX_COLUMNS: usize = 200;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StudioTable {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub rls_enabled: bool,
    pub estimated_rows: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StudioTablesPage {
    pub tables: Vec<StudioTable>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StudioColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_identity: bool,
    pub is_generated: bool,
    pub enum_values: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StudioForeignKey {
    pub name: String,
    pub definition: String,
    pub foreign_schema: String,
    pub foreign_table: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StudioIndex {
    pub name: String,
    pub definition: String,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StudioTableInfo {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub rls_enabled: Option<bool>,
    pub columns: Vec<StudioColumn>,
    pub foreign_keys: Vec<StudioForeignKey>,
    pub indexes: Vec<StudioIndex>,
    pub view_definition: Option<String>,
    pub introspected: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StudioRowFilter {
    pub column: String,
    pub operator: String,
    pub value: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StudioRowQuery {
    pub offset: u32,
    pub sort_column: Option<String>,
    #[serde(default)]
    pub sort_desc: bool,
    #[serde(default)]
    pub filters: Vec<StudioRowFilter>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StudioRowsPage {
    pub rows: Vec<Map<String, Value>>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StudioColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub default_value: Option<String>,
    #[serde(default)]
    pub nullable: bool,
    #[serde(default)]
    pub unique: bool,
    #[serde(default)]
    pub primary_key: bool,
    #[serde(default)]
    pub identity: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StudioTableDefinition {
    pub schema: String,
    pub name: String,
    pub columns: Vec<StudioColumnDefinition>,
    #[serde(default)]
    pub enable_rls: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct StudioColumnChange {
    pub new_name: Option<String>,
    pub data_type: Option<String>,
    pub default_value: Option<String>,
    #[serde(default)]
    pub drop_default: bool,
    pub nullable: Option<bool>,
}

fn check_offset(offset: u32) -> Result<(), String> {
    if offset > MAX_OFFSET {
        return Err("Ungültiger Offset.".into());
    }
    Ok(())
}

fn validate_data_type(data_type: &str) -> Result<String, String> {
    let invalid = || format!("Ungültiger Datentyp: {data_type}");
    let mut rest = data_type.trim();
    if rest.is_empty() || rest.len() > 100 {
        return Err(invalid());
    }
    let mut suffix = String::new();
    while let Some(stripped) = rest.strip_suffix("[]") {
        suffix.push_str("[]");
        rest = stripped.trim_end();
    }
    let mut modifier = String::new();
    if let Some(stripped) = rest.strip_suffix(')') {
        let (base, inner) = stripped.rsplit_once('(').ok_or_else(invalid)?;
        let parts = inner.split(',').map(str::trim).collect::<Vec<_>>();
        if parts.len() > 2
            || parts
                .iter()
                .any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err(invalid());
        }
        modifier = format!("({})", parts.join(","));
        rest = base.trim_end();
    }
    let words = rest.split_whitespace().collect::<Vec<_>>();
    let word_ok = |word: &&str| {
        let mut bytes = word.bytes();
        bytes
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
            && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.')
            && !word.contains("..")
            && !word.ends_with('.')
    };
    if words.is_empty() || words.len() > 4 || !words.iter().all(word_ok) {
        return Err(invalid());
    }
    Ok(format!("{}{modifier}{suffix}", words.join(" ")))
}

fn validate_default(expression: &str) -> Result<String, String> {
    let expression = expression.trim();
    if expression.is_empty()
        || expression.len() > 500
        || expression.contains(';')
        || expression.contains("--")
        || expression.contains("/*")
        || expression.contains('\0')
    {
        return Err(format!("Ungültiger Standardwert: {expression}"));
    }
    Ok(expression.to_string())
}

fn column_sql(column: &StudioColumnDefinition, inline_primary: bool) -> Result<String, String> {
    let mut sql = format!(
        "{} {}",
        quote_identifier(column.name.trim())?,
        validate_data_type(&column.data_type)?
    );
    match column
        .default_value
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    {
        Some(_) if column.identity => {
            return Err("Identity-Spalten können keinen Standardwert haben.".into())
        }
        Some(value) => sql.push_str(&format!(" DEFAULT {}", validate_default(value)?)),
        None if column.identity => sql.push_str(" GENERATED BY DEFAULT AS IDENTITY"),
        None => {}
    }
    if !column.nullable || column.primary_key {
        sql.push_str(" NOT NULL");
    }
    if column.unique && !column.primary_key {
        sql.push_str(" UNIQUE");
    }
    if inline_primary && column.primary_key {
        sql.push_str(" PRIMARY KEY");
    }
    Ok(sql)
}

fn create_table_sql(definition: &StudioTableDefinition) -> Result<String, String> {
    let target = qualified(definition.schema.trim(), definition.name.trim())?;
    if definition.columns.is_empty() || definition.columns.len() > MAX_COLUMNS {
        return Err("Eine Tabelle braucht 1 bis 200 Spalten.".into());
    }
    let mut names = std::collections::HashSet::new();
    let mut parts = Vec::new();
    for column in &definition.columns {
        if !names.insert(column.name.trim()) {
            return Err(format!("Spalte {} ist doppelt.", column.name.trim()));
        }
        parts.push(column_sql(column, false)?);
    }
    let primary = definition
        .columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| quote_identifier(column.name.trim()))
        .collect::<Result<Vec<_>, _>>()?;
    if !primary.is_empty() {
        parts.push(format!("PRIMARY KEY ({})", primary.join(", ")));
    }
    let mut sql = format!("CREATE TABLE {target} ({})", parts.join(", "));
    if definition.enable_rls {
        sql.push_str(&format!(";ALTER TABLE {target} ENABLE ROW LEVEL SECURITY"));
    }
    Ok(sql)
}

fn alter_column_sql(
    schema: &str,
    table: &str,
    column: &str,
    change: &StudioColumnChange,
) -> Result<String, String> {
    let target = qualified(schema, table)?;
    let quoted = quote_identifier(column)?;
    let mut actions = Vec::new();
    if let Some(data_type) = change.data_type.as_deref().filter(|v| !v.trim().is_empty()) {
        let data_type = validate_data_type(data_type)?;
        actions.push(format!(
            "ALTER COLUMN {quoted} TYPE {data_type} USING {quoted}::{data_type}"
        ));
    }
    if change.drop_default {
        actions.push(format!("ALTER COLUMN {quoted} DROP DEFAULT"));
    } else if let Some(value) = change.default_value.as_deref() {
        actions.push(format!(
            "ALTER COLUMN {quoted} SET DEFAULT {}",
            validate_default(value)?
        ));
    }
    match change.nullable {
        Some(true) => actions.push(format!("ALTER COLUMN {quoted} DROP NOT NULL")),
        Some(false) => actions.push(format!("ALTER COLUMN {quoted} SET NOT NULL")),
        None => {}
    }
    let mut statements = Vec::new();
    if !actions.is_empty() {
        statements.push(format!("ALTER TABLE {target} {}", actions.join(", ")));
    }
    if let Some(name) = change
        .new_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != column)
    {
        statements.push(format!(
            "ALTER TABLE {target} RENAME COLUMN {quoted} TO {}",
            quote_identifier(name)?
        ));
    }
    if statements.is_empty() {
        return Err("Keine Änderung angegeben.".into());
    }
    Ok(statements.join(";"))
}

fn drop_sql(schema: &str, table: &str, kind: &str, cascade: bool) -> Result<String, String> {
    let object = match kind {
        "table" | "partitioned_table" => "TABLE",
        "view" => "VIEW",
        "materialized_view" => "MATERIALIZED VIEW",
        "foreign_table" => "FOREIGN TABLE",
        _ => return Err("Unbekannter Objekttyp.".into()),
    };
    Ok(format!(
        "DROP {object} {}{}",
        qualified(schema, table)?,
        if cascade { " CASCADE" } else { "" }
    ))
}

fn param(value: &Value) -> Value {
    match value {
        Value::Null | Value::String(_) | Value::Array(_) => value.clone(),
        Value::Object(_) => Value::String(value.to_string()),
        Value::Bool(_) | Value::Number(_) => Value::String(value.to_string()),
    }
}

fn filter_sql(filter: &StudioRowFilter, parameters: &mut Vec<Value>) -> Result<String, String> {
    let column = quote_identifier(&filter.column)?;
    let mut next = |value: Value| {
        parameters.push(value);
        format!("${}", parameters.len())
    };
    let value = || {
        filter
            .value
            .clone()
            .ok_or_else(|| format!("Für {} fehlt ein Filterwert.", filter.column))
    };
    Ok(match filter.operator.as_str() {
        "is_null" => format!("{column} IS NULL"),
        "not_null" => format!("{column} IS NOT NULL"),
        "like" => format!("{column}::text LIKE {}", next(json!(value()?))),
        "ilike" => format!("{column}::text ILIKE {}", next(json!(value()?))),
        "in" => {
            let values = in_values(&value()?)?;
            let placeholders = values
                .into_iter()
                .map(|item| next(json!(item)))
                .collect::<Vec<_>>();
            format!("{column} IN ({})", placeholders.join(", "))
        }
        operator => {
            let symbol = comparison(operator)?;
            format!("{column} {symbol} {}", next(json!(value()?)))
        }
    })
}

fn comparison(operator: &str) -> Result<&'static str, String> {
    Ok(match operator {
        "eq" => "=",
        "neq" => "<>",
        "lt" => "<",
        "gt" => ">",
        "lte" => "<=",
        "gte" => ">=",
        _ => return Err("Unbekannter Filteroperator.".into()),
    })
}

fn in_values(raw: &str) -> Result<Vec<String>, String> {
    let values = raw
        .split(',')
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if values.is_empty() || values.len() > MAX_IN_VALUES {
        return Err("Die IN-Liste braucht 1 bis 100 Werte.".into());
    }
    Ok(values)
}

fn rows_sql(
    schema: &str,
    table: &str,
    query: &StudioRowQuery,
) -> Result<(String, Vec<Value>), String> {
    check_offset(query.offset)?;
    if query.filters.len() > MAX_FILTERS {
        return Err("Höchstens 20 Filter.".into());
    }
    let mut parameters = Vec::new();
    let conditions = query
        .filters
        .iter()
        .map(|filter| filter_sql(filter, &mut parameters))
        .collect::<Result<Vec<_>, _>>()?;
    let mut sql = format!("SELECT * FROM {}", qualified(schema, table)?);
    if !conditions.is_empty() {
        sql.push_str(&format!(" WHERE {}", conditions.join(" AND ")));
    }
    if let Some(column) = query.sort_column.as_deref() {
        sql.push_str(&format!(
            " ORDER BY {} {}",
            quote_identifier(column)?,
            if query.sort_desc { "DESC" } else { "ASC" }
        ));
    }
    sql.push_str(&format!(" LIMIT {} OFFSET {}", ROW_PAGE + 1, query.offset));
    Ok((sql, parameters))
}

fn key_condition(key: &Map<String, Value>, parameters: &mut Vec<Value>) -> Result<String, String> {
    if key.is_empty() {
        return Err("Zeilenschlüssel fehlt.".into());
    }
    let parts = key
        .iter()
        .map(|(column, value)| {
            if value.is_null() {
                return Err("Schlüsselwerte dürfen nicht NULL sein.".to_string());
            }
            parameters.push(param(value));
            Ok(format!(
                "{} = ${}",
                quote_identifier(column)?,
                parameters.len()
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join(" AND "))
}

fn insert_sql(
    schema: &str,
    table: &str,
    values: &Map<String, Value>,
) -> Result<(String, Vec<Value>), String> {
    let target = qualified(schema, table)?;
    if values.is_empty() {
        return Ok((
            format!("INSERT INTO {target} DEFAULT VALUES RETURNING *"),
            Vec::new(),
        ));
    }
    let columns = values
        .keys()
        .map(|column| quote_identifier(column))
        .collect::<Result<Vec<_>, _>>()?;
    let placeholders = (1..=values.len())
        .map(|index| format!("${index}"))
        .collect::<Vec<_>>();
    Ok((
        format!(
            "INSERT INTO {target} ({}) VALUES ({}) RETURNING *",
            columns.join(", "),
            placeholders.join(", ")
        ),
        values.values().map(param).collect(),
    ))
}

fn update_sql(
    schema: &str,
    table: &str,
    key: &Map<String, Value>,
    values: &Map<String, Value>,
) -> Result<(String, Vec<Value>), String> {
    if values.is_empty() {
        return Err("Keine Änderung angegeben.".into());
    }
    let mut parameters = Vec::new();
    let assignments = values
        .iter()
        .map(|(column, value)| {
            parameters.push(param(value));
            Ok(format!(
                "{} = ${}",
                quote_identifier(column)?,
                parameters.len()
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let condition = key_condition(key, &mut parameters)?;
    Ok((
        format!(
            "UPDATE {} SET {} WHERE {condition} RETURNING *",
            qualified(schema, table)?,
            assignments.join(", ")
        ),
        parameters,
    ))
}

fn delete_sql(
    schema: &str,
    table: &str,
    keys: &[Map<String, Value>],
) -> Result<(String, Vec<Value>), String> {
    if keys.is_empty() || keys.len() > MAX_KEYS {
        return Err("Es können 1 bis 500 Zeilen auf einmal gelöscht werden.".into());
    }
    let mut parameters = Vec::new();
    let conditions = keys
        .iter()
        .map(|key| key_condition(key, &mut parameters).map(|condition| format!("({condition})")))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((
        format!(
            "WITH deleted AS (DELETE FROM {} WHERE {} RETURNING 1) SELECT count(*)::int AS deleted FROM deleted",
            qualified(schema, table)?,
            conditions.join(" OR ")
        ),
        parameters,
    ))
}

const LIST_SQL: &str = "SELECT n.nspname AS schema, c.relname AS name, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE 'foreign_table' END AS kind, c.relrowsecurity AS rls_enabled, CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS estimated_rows FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%' AND ($1::text = '' OR n.nspname = $1::text) AND c.relname ILIKE $2::text ORDER BY n.nspname, c.relname";

const SCHEMAS_SQL: &str = "SELECT nspname AS name FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg\\_%' ORDER BY nspname LIMIT 500";

const DESCRIBE_SQL: &str = "SELECT n.nspname AS schema, c.relname AS name, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE 'foreign_table' END AS kind, c.relrowsecurity AS rls_enabled, CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS view_definition, true AS introspected,
COALESCE((SELECT json_agg(json_build_object('name', a.attname, 'data_type', format_type(a.atttypid, a.atttypmod), 'nullable', NOT a.attnotnull, 'default_value', pg_get_expr(d.adbin, d.adrelid), 'is_primary_key', EXISTS (SELECT 1 FROM pg_index x WHERE x.indrelid = c.oid AND x.indisprimary AND a.attnum = ANY(x.indkey)), 'is_unique', EXISTS (SELECT 1 FROM pg_index x WHERE x.indrelid = c.oid AND x.indisunique AND x.indnkeyatts = 1 AND x.indkey[0] = a.attnum), 'is_identity', a.attidentity <> '', 'is_generated', a.attgenerated <> '', 'enum_values', (SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = a.atttypid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '[]') AS columns,
COALESCE((SELECT json_agg(json_build_object('name', con.conname, 'definition', pg_get_constraintdef(con.oid), 'foreign_schema', fn.nspname, 'foreign_table', fc.relname) ORDER BY con.conname) FROM pg_constraint con JOIN pg_class fc ON fc.oid = con.confrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace WHERE con.conrelid = c.oid AND con.contype = 'f'), '[]') AS foreign_keys,
COALESCE((SELECT json_agg(json_build_object('name', i.relname, 'definition', pg_get_indexdef(x.indexrelid), 'is_unique', x.indisunique, 'is_primary', x.indisprimary) ORDER BY i.relname) FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = c.oid), '[]') AS indexes
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1::text AND c.relname = $2::text AND c.relkind IN ('r', 'p', 'v', 'm', 'f')";

const PRIMARY_KEY_SQL: &str = "SELECT a.attname AS name FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(x.indkey) WHERE x.indisprimary AND n.nspname = $1::text AND c.relname = $2::text";

async fn sql_mode(reference: &str) -> Result<bool, String> {
    uses_pg_meta(validate_ref(reference)?).await
}

async fn require_sql(reference: &str) -> Result<(), String> {
    if sql_mode(reference).await? {
        Ok(())
    } else {
        Err("Benötigt SQL-Zugriff: Secret Key einer selbst gehosteten Instanz oder Supabase-Zugangstoken.".into())
    }
}

async fn ensure_primary_key(
    reference: &str,
    schema: &str,
    table: &str,
    keys: &[&Map<String, Value>],
) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Name {
        name: String,
    }
    let primary: Vec<Name> =
        database_query(reference, PRIMARY_KEY_SQL, &[json!(schema), json!(table)]).await?;
    if primary.is_empty() {
        return Err("Die Tabelle hat keinen Primärschlüssel und ist nur lesbar.".into());
    }
    let mut expected = primary
        .into_iter()
        .map(|item| item.name)
        .collect::<Vec<_>>();
    expected.sort();
    for key in keys {
        let mut actual = key.keys().cloned().collect::<Vec<_>>();
        actual.sort();
        if actual != expected {
            return Err("Der Zeilenschlüssel muss genau den Primärschlüssel enthalten.".into());
        }
    }
    Ok(())
}

fn rest_column(column: &str) -> Result<String, String> {
    if column.is_empty() || column.len() > 128 || column.contains(['"', '\\', '\0']) {
        return Err("Ungültiger Spaltenname.".into());
    }
    if column
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        Ok(column.to_string())
    } else {
        Ok(format!("\"{column}\""))
    }
}

fn rest_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn rest_quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn rest_filter(filter: &StudioRowFilter) -> Result<(String, String), String> {
    let column = rest_column(&filter.column)?;
    let value = || {
        filter
            .value
            .clone()
            .ok_or_else(|| format!("Für {} fehlt ein Filterwert.", filter.column))
    };
    let expression = match filter.operator.as_str() {
        "is_null" => "is.null".to_string(),
        "not_null" => "not.is.null".to_string(),
        "in" => format!(
            "in.({})",
            in_values(&value()?)?
                .iter()
                .map(|item| rest_quoted(item))
                .collect::<Vec<_>>()
                .join(",")
        ),
        operator @ ("eq" | "neq" | "lt" | "gt" | "lte" | "gte" | "like" | "ilike") => {
            format!("{operator}.{}", value()?)
        }
        _ => return Err("Unbekannter Filteroperator.".into()),
    };
    Ok((column, expression))
}

fn rest_query(query: &StudioRowQuery) -> Result<Vec<(String, String)>, String> {
    check_offset(query.offset)?;
    if query.filters.len() > MAX_FILTERS {
        return Err("Höchstens 20 Filter.".into());
    }
    let mut pairs = vec![
        ("select".to_string(), "*".to_string()),
        ("limit".to_string(), (ROW_PAGE + 1).to_string()),
        ("offset".to_string(), query.offset.to_string()),
    ];
    if let Some(column) = query.sort_column.as_deref() {
        pairs.push((
            "order".into(),
            format!(
                "{}.{}",
                rest_column(column)?,
                if query.sort_desc { "desc" } else { "asc" }
            ),
        ));
    }
    for filter in &query.filters {
        pairs.push(rest_filter(filter)?);
    }
    Ok(pairs)
}

fn rest_key_pairs(keys: &[Map<String, Value>]) -> Result<Vec<(String, String)>, String> {
    if keys.is_empty() || keys.len() > MAX_KEYS {
        return Err("Es können 1 bis 500 Zeilen auf einmal gelöscht werden.".into());
    }
    if keys
        .iter()
        .any(|key| key.is_empty() || key.values().any(Value::is_null))
    {
        return Err("Schlüsselwerte dürfen nicht leer oder NULL sein.".into());
    }
    if keys.len() == 1 {
        return keys[0]
            .iter()
            .map(|(column, value)| Ok((rest_column(column)?, format!("eq.{}", rest_value(value)))))
            .collect();
    }
    let columns = keys[0].keys().collect::<Vec<_>>();
    if keys
        .iter()
        .any(|key| key.keys().collect::<Vec<_>>() != columns)
    {
        return Err("Alle Zeilenschlüssel brauchen dieselben Spalten.".into());
    }
    if columns.len() == 1 {
        let values = keys
            .iter()
            .map(|key| rest_quoted(&rest_value(&key[columns[0].as_str()])))
            .collect::<Vec<_>>();
        return Ok(vec![(
            rest_column(columns[0])?,
            format!("in.({})", values.join(",")),
        )]);
    }
    let groups = keys
        .iter()
        .map(|key| {
            key.iter()
                .map(|(column, value)| {
                    Ok(format!(
                        "{}.eq.{}",
                        rest_column(column)?,
                        rest_quoted(&rest_value(value))
                    ))
                })
                .collect::<Result<Vec<_>, String>>()
                .map(|parts| format!("and({})", parts.join(",")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(vec![("or".into(), format!("({})", groups.join(",")))])
}

async fn rest_url(reference: &str, table: &str) -> Result<reqwest::Url, String> {
    if table.is_empty() || table.len() > 128 || table.contains('\0') {
        return Err("Ungültiger Tabellenname.".into());
    }
    let mut url = project_url(reference, "rest/v1/").await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .pop_if_empty()
        .push(table);
    Ok(url)
}

async fn rest_send(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let response = request
        .send()
        .await
        .map_err(|error| format!("Supabase Data API ist nicht erreichbar: {error}"))?;
    let status = response.status();
    if status.is_success() {
        return response
            .json::<Value>()
            .await
            .map_err(|_| "Supabase hat unerwartete Daten geliefert.".to_string());
    }
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    let message = ["message", "details", "hint"]
        .iter()
        .filter_map(|field| body[*field].as_str())
        .collect::<Vec<_>>()
        .join(" ");
    Err(if message.is_empty() {
        format!("Supabase Data API HTTP {}.", status.as_u16())
    } else {
        format!("Supabase Data API HTTP {}: {message}", status.as_u16())
    })
}

async fn rest_request(
    reference: &str,
    method: reqwest::Method,
    schema: &str,
    table: &str,
    pairs: &[(String, String)],
) -> Result<reqwest::RequestBuilder, String> {
    let mut url = rest_url(reference, table).await?;
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    let write = method != reqwest::Method::GET;
    let request = project_api_auth(
        client().request(method, url),
        &project_secret_key(reference).await?,
    )
    .header("Accept-Profile", schema);
    Ok(if write {
        request.header("Content-Profile", schema)
    } else {
        request
    })
}

fn rows_of(value: Value) -> Result<Vec<Map<String, Value>>, String> {
    serde_json::from_value(value).map_err(|_| "Supabase hat unerwartete Daten geliefert.".into())
}

async fn openapi_info(
    reference: &str,
    schema: &str,
    table: &str,
) -> Result<StudioTableInfo, String> {
    let mut info = StudioTableInfo {
        schema: schema.into(),
        name: table.into(),
        kind: "unknown".into(),
        rls_enabled: None,
        columns: Vec::new(),
        foreign_keys: Vec::new(),
        indexes: Vec::new(),
        view_definition: None,
        introspected: false,
    };
    let response = project_api_auth(
        client().get(project_url(reference, "rest/v1/").await?),
        &project_secret_key(reference).await?,
    )
    .header("Accept-Profile", schema)
    .send()
    .await
    .map_err(|error| format!("Supabase Data API ist nicht erreichbar: {error}"))?;
    if matches!(response.status().as_u16(), 401 | 403 | 406) {
        return Ok(info);
    }
    let document: Value = response_json(response).await?;
    let Some(definition) = document["definitions"].get(table) else {
        return Ok(info);
    };
    info.columns = openapi_columns(definition);
    info.introspected = !info.columns.is_empty();
    info.kind = if document["paths"][format!("/{table}")]["post"].is_object() {
        "table".into()
    } else {
        "view".into()
    };
    Ok(info)
}

fn openapi_columns(definition: &Value) -> Vec<StudioColumn> {
    let required = definition["required"]
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    definition["properties"]
        .as_object()
        .map(|properties| {
            properties
                .iter()
                .map(|(name, property)| StudioColumn {
                    name: name.clone(),
                    data_type: property["format"].as_str().unwrap_or("text").to_string(),
                    nullable: !required.contains(&name.as_str()),
                    default_value: property.get("default").map(|value| match value {
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    }),
                    is_primary_key: property["description"]
                        .as_str()
                        .is_some_and(|text| text.contains("<pk/>")),
                    enum_values: property["enum"].as_array().map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    }),
                    ..StudioColumn::default()
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn supabase_studio_tables_schemas(reference: String) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Name {
        name: String,
    }
    require_sql(&reference).await?;
    let names: Vec<Name> = database_query(&reference, SCHEMAS_SQL, &[]).await?;
    Ok(names.into_iter().map(|item| item.name).collect())
}

#[tauri::command]
pub async fn supabase_studio_tables_list(
    reference: String,
    schema: String,
    search: String,
    offset: u32,
) -> Result<StudioTablesPage, String> {
    check_offset(offset)?;
    if schema.len() > 128 || search.len() > 128 {
        return Err("Suchbegriff zu lang.".into());
    }
    require_sql(&reference).await?;
    let query = format!("{LIST_SQL} LIMIT {} OFFSET {offset}", TABLE_PAGE + 1);
    let mut tables: Vec<StudioTable> = database_query(
        &reference,
        &query,
        &[json!(schema), json!(like_pattern(&search))],
    )
    .await?;
    let has_more = tables.len() > TABLE_PAGE;
    tables.truncate(TABLE_PAGE);
    Ok(StudioTablesPage { tables, has_more })
}

#[tauri::command]
pub async fn supabase_studio_tables_describe(
    reference: String,
    schema: String,
    table: String,
) -> Result<StudioTableInfo, String> {
    qualified(&schema, &table)?;
    if !sql_mode(&reference).await? {
        return openapi_info(&reference, &schema, &table).await;
    }
    database_query::<StudioTableInfo>(&reference, DESCRIBE_SQL, &[json!(schema), json!(table)])
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| format!("Tabelle {schema}.{table} nicht gefunden."))
}

#[tauri::command]
pub async fn supabase_studio_tables_rows(
    reference: String,
    schema: String,
    table: String,
    query: StudioRowQuery,
) -> Result<StudioRowsPage, String> {
    let mut rows = if sql_mode(&reference).await? {
        let (sql, parameters) = rows_sql(&schema, &table, &query)?;
        database_query::<Map<String, Value>>(&reference, &sql, &parameters).await?
    } else {
        qualified(&schema, &table)?;
        let pairs = rest_query(&query)?;
        rows_of(
            rest_send(
                rest_request(&reference, reqwest::Method::GET, &schema, &table, &pairs).await?,
            )
            .await?,
        )?
    };
    let has_more = rows.len() > ROW_PAGE;
    rows.truncate(ROW_PAGE);
    Ok(StudioRowsPage { rows, has_more })
}

#[tauri::command]
pub async fn supabase_studio_tables_insert_row(
    reference: String,
    schema: String,
    table: String,
    values: Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    if values.len() > MAX_COLUMNS {
        return Err("Zu viele Spalten.".into());
    }
    let rows = if sql_mode(&reference).await? {
        let (sql, parameters) = insert_sql(&schema, &table, &values)?;
        rows_of(Value::Array(
            database_execute(&reference, &sql, &parameters).await?,
        ))?
    } else {
        qualified(&schema, &table)?;
        rows_of(
            rest_send(
                rest_request(&reference, reqwest::Method::POST, &schema, &table, &[])
                    .await?
                    .header("Prefer", "return=representation")
                    .json(&values),
            )
            .await?,
        )?
    };
    rows.into_iter()
        .next()
        .ok_or_else(|| "Die Zeile wurde eingefügt, ist aber wegen RLS nicht lesbar.".into())
}

#[tauri::command]
pub async fn supabase_studio_tables_update_row(
    reference: String,
    schema: String,
    table: String,
    key: Map<String, Value>,
    values: Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    if values.len() > MAX_COLUMNS {
        return Err("Zu viele Spalten.".into());
    }
    let rows = if sql_mode(&reference).await? {
        let (sql, parameters) = update_sql(&schema, &table, &key, &values)?;
        ensure_primary_key(&reference, &schema, &table, &[&key]).await?;
        rows_of(Value::Array(
            database_execute(&reference, &sql, &parameters).await?,
        ))?
    } else {
        qualified(&schema, &table)?;
        if values.is_empty() {
            return Err("Keine Änderung angegeben.".into());
        }
        let pairs = rest_key_pairs(std::slice::from_ref(&key))?;
        rows_of(
            rest_send(
                rest_request(&reference, reqwest::Method::PATCH, &schema, &table, &pairs)
                    .await?
                    .header(
                        "Prefer",
                        "return=representation, handling=strict, max-affected=1",
                    )
                    .json(&values),
            )
            .await?,
        )?
    };
    rows.into_iter()
        .next()
        .ok_or_else(|| "Keine Zeile geändert. Prüfe den Schlüssel und die RLS-Richtlinien.".into())
}

#[tauri::command]
pub async fn supabase_studio_tables_delete_rows(
    reference: String,
    schema: String,
    table: String,
    keys: Vec<Map<String, Value>>,
) -> Result<u32, String> {
    if sql_mode(&reference).await? {
        let (sql, parameters) = delete_sql(&schema, &table, &keys)?;
        ensure_primary_key(
            &reference,
            &schema,
            &table,
            &keys.iter().collect::<Vec<_>>(),
        )
        .await?;
        let result = database_execute(&reference, &sql, &parameters).await?;
        return Ok(result
            .first()
            .and_then(|row| row["deleted"].as_u64())
            .unwrap_or(0) as u32);
    }
    qualified(&schema, &table)?;
    let pairs = rest_key_pairs(&keys)?;
    let deleted = rows_of(
        rest_send(
            rest_request(&reference, reqwest::Method::DELETE, &schema, &table, &pairs)
                .await?
                .header(
                    "Prefer",
                    format!(
                        "return=representation, handling=strict, max-affected={}",
                        keys.len()
                    ),
                ),
        )
        .await?,
    )?;
    Ok(deleted.len() as u32)
}

async fn execute_ddl(reference: &str, sql: &str) -> Result<(), String> {
    require_sql(reference).await?;
    database_execute(reference, sql, &[]).await.map(|_| ())
}

#[tauri::command]
pub async fn supabase_studio_tables_create_table(
    reference: String,
    definition: StudioTableDefinition,
) -> Result<(), String> {
    execute_ddl(&reference, &create_table_sql(&definition)?).await
}

#[tauri::command]
pub async fn supabase_studio_tables_rename_table(
    reference: String,
    schema: String,
    table: String,
    new_name: String,
) -> Result<(), String> {
    let sql = format!(
        "ALTER TABLE {} RENAME TO {}",
        qualified(&schema, &table)?,
        quote_identifier(new_name.trim())?
    );
    execute_ddl(&reference, &sql).await
}

#[tauri::command]
pub async fn supabase_studio_tables_drop_table(
    reference: String,
    schema: String,
    table: String,
    kind: String,
    cascade: bool,
) -> Result<(), String> {
    execute_ddl(&reference, &drop_sql(&schema, &table, &kind, cascade)?).await
}

#[tauri::command]
pub async fn supabase_studio_tables_truncate(
    reference: String,
    schema: String,
    table: String,
    restart_identity: bool,
    cascade: bool,
) -> Result<(), String> {
    let sql = format!(
        "TRUNCATE {}{}{}",
        qualified(&schema, &table)?,
        if restart_identity {
            " RESTART IDENTITY"
        } else {
            ""
        },
        if cascade { " CASCADE" } else { "" }
    );
    execute_ddl(&reference, &sql).await
}

#[tauri::command]
pub async fn supabase_studio_tables_set_rls(
    reference: String,
    schema: String,
    table: String,
    enabled: bool,
) -> Result<(), String> {
    let sql = format!(
        "ALTER TABLE {} {} ROW LEVEL SECURITY",
        qualified(&schema, &table)?,
        if enabled { "ENABLE" } else { "DISABLE" }
    );
    execute_ddl(&reference, &sql).await
}

#[tauri::command]
pub async fn supabase_studio_tables_add_column(
    reference: String,
    schema: String,
    table: String,
    column: StudioColumnDefinition,
) -> Result<(), String> {
    let sql = format!(
        "ALTER TABLE {} ADD COLUMN {}",
        qualified(&schema, &table)?,
        column_sql(&column, true)?
    );
    execute_ddl(&reference, &sql).await
}

#[tauri::command]
pub async fn supabase_studio_tables_alter_column(
    reference: String,
    schema: String,
    table: String,
    column: String,
    change: StudioColumnChange,
) -> Result<(), String> {
    execute_ddl(
        &reference,
        &alter_column_sql(&schema, &table, &column, &change)?,
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_tables_drop_column(
    reference: String,
    schema: String,
    table: String,
    column: String,
    cascade: bool,
) -> Result<(), String> {
    let sql = format!(
        "ALTER TABLE {} DROP COLUMN {}{}",
        qualified(&schema, &table)?,
        quote_identifier(&column)?,
        if cascade { " CASCADE" } else { "" }
    );
    execute_ddl(&reference, &sql).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(column: &str, operator: &str, value: Option<&str>) -> StudioRowFilter {
        StudioRowFilter {
            column: column.into(),
            operator: operator.into(),
            value: value.map(str::to_string),
        }
    }

    fn key(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(column, value)| (column.to_string(), value.clone()))
            .collect()
    }

    #[test]
    fn data_types_are_validated() {
        assert_eq!(validate_data_type("text").unwrap(), "text");
        assert_eq!(
            validate_data_type(" numeric( 10 , 2 ) ").unwrap(),
            "numeric(10,2)"
        );
        assert_eq!(
            validate_data_type("timestamp with time zone").unwrap(),
            "timestamp with time zone"
        );
        assert_eq!(
            validate_data_type("public.mood[]").unwrap(),
            "public.mood[]"
        );
        assert_eq!(
            validate_data_type("varchar(20)[]").unwrap(),
            "varchar(20)[]"
        );
        for bad in [
            "",
            "text; drop table x",
            "int) default 1",
            "text default (select 1)",
            "a b c d e",
            "1abc",
            "numeric(a)",
            "x..y",
        ] {
            assert!(validate_data_type(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn defaults_reject_statement_breaks() {
        assert_eq!(validate_default(" now() ").unwrap(), "now()");
        assert!(validate_default("1; drop table x").is_err());
        assert!(validate_default("1 -- x").is_err());
        assert!(validate_default("").is_err());
    }

    #[test]
    fn create_table_builds_constraints_and_rls() {
        let definition = StudioTableDefinition {
            schema: "public".into(),
            name: "to\"do".into(),
            columns: vec![
                StudioColumnDefinition {
                    name: "id".into(),
                    data_type: "bigint".into(),
                    default_value: None,
                    nullable: false,
                    unique: false,
                    primary_key: true,
                    identity: true,
                },
                StudioColumnDefinition {
                    name: "title".into(),
                    data_type: "text".into(),
                    default_value: Some("'x'".into()),
                    nullable: true,
                    unique: true,
                    primary_key: false,
                    identity: false,
                },
            ],
            enable_rls: true,
        };
        assert_eq!(
            create_table_sql(&definition).unwrap(),
            "CREATE TABLE \"public\".\"to\"\"do\" (\"id\" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL, \"title\" text DEFAULT 'x' UNIQUE, PRIMARY KEY (\"id\"));ALTER TABLE \"public\".\"to\"\"do\" ENABLE ROW LEVEL SECURITY"
        );
        let mut duplicate = definition.clone();
        duplicate.columns[1].name = "id".into();
        assert!(create_table_sql(&duplicate).is_err());
        let mut empty = definition;
        empty.columns.clear();
        assert!(create_table_sql(&empty).is_err());
    }

    #[test]
    fn alter_column_combines_actions_and_rename() {
        let change = StudioColumnChange {
            new_name: Some("label".into()),
            data_type: Some("varchar(50)".into()),
            default_value: Some("'a'".into()),
            drop_default: false,
            nullable: Some(false),
        };
        assert_eq!(
            alter_column_sql("public", "t", "name", &change).unwrap(),
            "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"name\" TYPE varchar(50) USING \"name\"::varchar(50), ALTER COLUMN \"name\" SET DEFAULT 'a', ALTER COLUMN \"name\" SET NOT NULL;ALTER TABLE \"public\".\"t\" RENAME COLUMN \"name\" TO \"label\""
        );
        assert!(alter_column_sql("public", "t", "name", &StudioColumnChange::default()).is_err());
        assert_eq!(
            drop_sql("s", "v", "view", true).unwrap(),
            "DROP VIEW \"s\".\"v\" CASCADE"
        );
        assert!(drop_sql("s", "v", "index", false).is_err());
    }

    #[test]
    fn rows_sql_uses_parameters() {
        let query = StudioRowQuery {
            offset: 50,
            sort_column: Some("created at".into()),
            sort_desc: true,
            filters: vec![
                filter("name", "ilike", Some("%a'b%")),
                filter("id", "in", Some("1, 2,3")),
                filter("deleted", "is_null", None),
                filter("age", "gte", Some("18")),
            ],
        };
        let (sql, parameters) = rows_sql("public", "people", &query).unwrap();
        assert_eq!(
            sql,
            "SELECT * FROM \"public\".\"people\" WHERE \"name\"::text ILIKE $1 AND \"id\" IN ($2, $3, $4) AND \"deleted\" IS NULL AND \"age\" >= $5 ORDER BY \"created at\" DESC LIMIT 51 OFFSET 50"
        );
        assert_eq!(
            parameters,
            vec![
                json!("%a'b%"),
                json!("1"),
                json!("2"),
                json!("3"),
                json!("18")
            ]
        );
        let bad = StudioRowQuery {
            offset: 0,
            sort_column: None,
            sort_desc: false,
            filters: vec![filter("x", "; drop", Some("1"))],
        };
        assert!(rows_sql("public", "people", &bad).is_err());
        let missing = StudioRowQuery {
            offset: 0,
            sort_column: None,
            sort_desc: false,
            filters: vec![filter("x", "eq", None)],
        };
        assert!(rows_sql("public", "people", &missing).is_err());
        let far = StudioRowQuery {
            offset: MAX_OFFSET + 1,
            sort_column: None,
            sort_desc: false,
            filters: Vec::new(),
        };
        assert!(rows_sql("public", "people", &far).is_err());
    }

    #[test]
    fn row_writes_use_parameters_and_keys() {
        let values = key(&[
            ("meta", json!({"a": 1})),
            ("name", json!("x")),
            ("n", json!(3)),
        ]);
        let (sql, parameters) = insert_sql("public", "t", &values).unwrap();
        assert_eq!(
            sql,
            "INSERT INTO \"public\".\"t\" (\"meta\", \"name\", \"n\") VALUES ($1, $2, $3) RETURNING *"
        );
        assert_eq!(parameters, vec![json!("{\"a\":1}"), json!("x"), json!("3")]);
        assert_eq!(
            insert_sql("public", "t", &Map::new()).unwrap().0,
            "INSERT INTO \"public\".\"t\" DEFAULT VALUES RETURNING *"
        );
        let (sql, parameters) = update_sql(
            "public",
            "t",
            &key(&[("id", json!(7))]),
            &key(&[("name", Value::Null)]),
        )
        .unwrap();
        assert_eq!(
            sql,
            "UPDATE \"public\".\"t\" SET \"name\" = $1 WHERE \"id\" = $2 RETURNING *"
        );
        assert_eq!(parameters, vec![Value::Null, json!("7")]);
        assert!(update_sql("public", "t", &Map::new(), &key(&[("a", json!(1))])).is_err());
        assert!(update_sql(
            "public",
            "t",
            &key(&[("id", Value::Null)]),
            &key(&[("a", json!(1))])
        )
        .is_err());
        let (sql, parameters) = delete_sql(
            "public",
            "t",
            &[
                key(&[("a", json!(1)), ("b", json!("x"))]),
                key(&[("a", json!(2)), ("b", json!("y"))]),
            ],
        )
        .unwrap();
        assert_eq!(
            sql,
            "WITH deleted AS (DELETE FROM \"public\".\"t\" WHERE (\"a\" = $1 AND \"b\" = $2) OR (\"a\" = $3 AND \"b\" = $4) RETURNING 1) SELECT count(*)::int AS deleted FROM deleted"
        );
        assert_eq!(parameters.len(), 4);
        assert!(delete_sql("public", "t", &[]).is_err());
    }

    #[test]
    fn rest_filters_and_keys_are_encoded() {
        let query = StudioRowQuery {
            offset: 0,
            sort_column: Some("name".into()),
            sort_desc: false,
            filters: vec![
                filter("first name", "eq", Some("Ann")),
                filter("tag", "in", Some("a\"b,c")),
                filter("x", "not_null", None),
            ],
        };
        let pairs = rest_query(&query).unwrap();
        assert!(pairs.contains(&("order".into(), "name.asc".into())));
        assert!(pairs.contains(&("\"first name\"".into(), "eq.Ann".into())));
        assert!(pairs.contains(&("tag".into(), "in.(\"a\\\"b\",\"c\")".into())));
        assert!(pairs.contains(&("x".into(), "not.is.null".into())));
        assert!(rest_column("a\"b").is_err());
        assert_eq!(
            rest_key_pairs(&[key(&[("id", json!(1))])]).unwrap(),
            vec![("id".to_string(), "eq.1".to_string())]
        );
        assert_eq!(
            rest_key_pairs(&[key(&[("id", json!(1))]), key(&[("id", json!("2"))])]).unwrap(),
            vec![("id".to_string(), "in.(\"1\",\"2\")".to_string())]
        );
        assert_eq!(
            rest_key_pairs(&[
                key(&[("a", json!(1)), ("b", json!(2))]),
                key(&[("a", json!(3)), ("b", json!(4))])
            ])
            .unwrap(),
            vec![(
                "or".to_string(),
                "(and(a.eq.\"1\",b.eq.\"2\"),and(a.eq.\"3\",b.eq.\"4\"))".to_string()
            )]
        );
        assert!(rest_key_pairs(&[key(&[("id", Value::Null)])]).is_err());
        assert!(rest_key_pairs(&[]).is_err());
    }

    #[test]
    fn openapi_columns_detect_primary_keys() {
        let definition = json!({
            "required": ["id"],
            "properties": {
                "id": {"format": "bigint", "type": "integer", "description": "Note:\nThis is a Primary Key.<pk/>"},
                "mood": {"format": "public.mood", "type": "string", "enum": ["a", "b"], "default": "a"}
            }
        });
        let columns = openapi_columns(&definition);
        assert!(columns[0].is_primary_key && !columns[0].nullable);
        assert_eq!(
            columns[1].enum_values,
            Some(vec!["a".to_string(), "b".to_string()])
        );
        assert_eq!(columns[1].default_value.as_deref(), Some("a"));
        assert!(columns[1].nullable);
        assert_eq!(like_pattern(" a_b% "), "%a\\_b\\%%");
    }

    #[tokio::test]
    #[ignore]
    async fn supabase_studio_tables_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        use crate::supabase::supabase_connect_self_hosted;
        let (Some(url), Some(secret)) =
            (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let project = supabase_connect_self_hosted(url.clone(), secret.clone(), "Lab".into())
            .await
            .unwrap();
        let reference = project.reference.clone();
        let table = format!("l8db_studio_tables_{}", std::process::id());
        let renamed = format!("{table}_r");
        let schema = "public".to_string();
        let definition: StudioTableDefinition = serde_json::from_value(json!({
            "schema": schema,
            "name": table,
            "enable_rls": true,
            "columns": [
                {"name": "id", "data_type": "bigint", "primary_key": true, "identity": true},
                {"name": "title", "data_type": "text", "nullable": false, "default_value": "'neu'"},
                {"name": "meta", "data_type": "jsonb", "nullable": true},
                {"name": "tags", "data_type": "text[]", "nullable": true}
            ]
        }))
        .unwrap();
        supabase_studio_tables_create_table(reference.clone(), definition)
            .await
            .unwrap();

        let result = futures_util::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(async {
            assert!(supabase_studio_tables_schemas(reference.clone())
                .await
                .unwrap()
                .contains(&schema));
            let listed =
                supabase_studio_tables_list(reference.clone(), schema.clone(), table.clone(), 0)
                    .await
                    .unwrap();
            assert_eq!(listed.tables.len(), 1);
            assert!(listed.tables[0].rls_enabled);

            let info =
                supabase_studio_tables_describe(reference.clone(), schema.clone(), table.clone())
                    .await
                    .unwrap();
            assert_eq!(info.kind, "table");
            assert!(info.columns[0].is_primary_key && info.columns[0].is_identity);
            assert_eq!(info.columns[1].default_value.as_deref(), Some("'neu'::text"));
            assert!(info.indexes.iter().any(|index| index.is_primary));

            for index in 0..60 {
                supabase_studio_tables_insert_row(
                    reference.clone(),
                    schema.clone(),
                    table.clone(),
                    key(&[("title", json!(format!("row {index:02}"))), ("meta", json!("{\"n\": 1}"))]),
                )
                .await
                .unwrap();
            }
            let inserted = supabase_studio_tables_insert_row(
                reference.clone(),
                schema.clone(),
                table.clone(),
                Map::new(),
            )
            .await
            .unwrap();
            assert_eq!(inserted["title"], json!("neu"));
            let id = inserted["id"].clone();

            let query = |offset, filters| StudioRowQuery {
                offset,
                sort_column: Some("id".into()),
                sort_desc: false,
                filters,
            };
            let first = supabase_studio_tables_rows(reference.clone(), schema.clone(), table.clone(), query(0, Vec::new()))
                .await
                .unwrap();
            assert_eq!(first.rows.len(), 50);
            assert!(first.has_more);
            assert_eq!(first.rows[0]["meta"], json!({"n": 1}));
            let second = supabase_studio_tables_rows(reference.clone(), schema.clone(), table.clone(), query(50, Vec::new()))
                .await
                .unwrap();
            assert_eq!(second.rows.len(), 11);
            assert!(!second.has_more);
            let filtered = supabase_studio_tables_rows(
                reference.clone(),
                schema.clone(),
                table.clone(),
                query(0, vec![filter("title", "ilike", Some("ROW 1%")), filter("id", "not_null", None)]),
            )
            .await
            .unwrap();
            assert_eq!(filtered.rows.len(), 10);

            let updated = supabase_studio_tables_update_row(
                reference.clone(),
                schema.clone(),
                table.clone(),
                key(&[("id", id.clone())]),
                key(&[("title", json!("geändert")), ("meta", Value::Null), ("tags", json!(["a", "c"]))]),
            )
            .await
            .unwrap();
            assert_eq!(updated["title"], json!("geändert"));
            assert_eq!(updated["tags"], json!(["a", "c"]));
            assert!(supabase_studio_tables_update_row(
                reference.clone(),
                schema.clone(),
                table.clone(),
                key(&[("title", json!("geändert"))]),
                key(&[("title", json!("x"))]),
            )
            .await
            .is_err());
            let keys = first.rows[..5]
                .iter()
                .map(|row| key(&[("id", row["id"].clone())]))
                .collect::<Vec<_>>();
            assert_eq!(
                supabase_studio_tables_delete_rows(reference.clone(), schema.clone(), table.clone(), keys)
                    .await
                    .unwrap(),
                5
            );

            latency("studio tables list", 500, || {
                let reference = reference.clone();
                async move {
                    supabase_studio_tables_list(reference, String::new(), String::new(), 0)
                        .await
                        .unwrap();
                }
            })
            .await;
            latency("studio tables describe", 500, || {
                let (reference, schema, table) = (reference.clone(), schema.clone(), table.clone());
                async move {
                    supabase_studio_tables_describe(reference, schema, table).await.unwrap();
                }
            })
            .await;
            latency("studio tables rows sql", 500, || {
                let (reference, schema, table) = (reference.clone(), schema.clone(), table.clone());
                async move {
                    supabase_studio_tables_rows(
                        reference,
                        schema,
                        table,
                        query(0, vec![filter("title", "like", Some("row%"))]),
                    )
                    .await
                    .unwrap();
                }
            })
            .await;

            supabase_studio_tables_add_column(
                reference.clone(),
                schema.clone(),
                table.clone(),
                serde_json::from_value(json!({"name": "score", "data_type": "integer", "nullable": true, "unique": true})).unwrap(),
            )
            .await
            .unwrap();
            supabase_studio_tables_alter_column(
                reference.clone(),
                schema.clone(),
                table.clone(),
                "score".into(),
                StudioColumnChange {
                    new_name: Some("points".into()),
                    data_type: Some("bigint".into()),
                    default_value: Some("0".into()),
                    drop_default: false,
                    nullable: Some(true),
                },
            )
            .await
            .unwrap();
            let info =
                supabase_studio_tables_describe(reference.clone(), schema.clone(), table.clone())
                    .await
                    .unwrap();
            let points = info.columns.iter().find(|column| column.name == "points").unwrap();
            assert_eq!(points.data_type, "bigint");
            assert!(points.is_unique);
            assert_eq!(points.default_value.as_deref(), Some("0"));
            supabase_studio_tables_drop_column(reference.clone(), schema.clone(), table.clone(), "points".into(), false)
                .await
                .unwrap();

            supabase_studio_tables_set_rls(reference.clone(), schema.clone(), table.clone(), false)
                .await
                .unwrap();
            supabase_studio_tables_rename_table(reference.clone(), schema.clone(), table.clone(), renamed.clone())
                .await
                .unwrap();
            assert!(supabase_studio_tables_describe(reference.clone(), schema.clone(), table.clone())
                .await
                .is_err());

            if let Some(public_key) = env("L8DB_E2E_SUPABASE_PUBLIC_KEYS")
                .and_then(|keys| keys.split(',').next().map(str::to_string))
            {
                supabase_connect_self_hosted(url.clone(), public_key, "Lab".into())
                    .await
                    .unwrap();
                let rest_query = |filters| StudioRowQuery {
                    offset: 0,
                    sort_column: Some("id".into()),
                    sort_desc: true,
                    filters,
                };
                let mut page = None;
                for _ in 0..50 {
                    match supabase_studio_tables_rows(reference.clone(), schema.clone(), renamed.clone(), rest_query(Vec::new())).await {
                        Ok(rows) => {
                            page = Some(rows);
                            break;
                        }
                        Err(_) => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
                    }
                }
                let page = page.expect("PostgREST schema cache did not pick up the table");
                assert_eq!(page.rows.len(), 50);
                assert!(page.has_more);
                let info = supabase_studio_tables_describe(reference.clone(), schema.clone(), renamed.clone())
                    .await
                    .unwrap();
                assert!(!info.introspected);
                let created = supabase_studio_tables_insert_row(
                    reference.clone(),
                    schema.clone(),
                    renamed.clone(),
                    key(&[("title", json!("rest")), ("meta", json!({"k": [1, 2]}))]),
                )
                .await
                .unwrap();
                assert_eq!(created["meta"], json!({"k": [1, 2]}));
                let updated = supabase_studio_tables_update_row(
                    reference.clone(),
                    schema.clone(),
                    renamed.clone(),
                    key(&[("id", created["id"].clone())]),
                    key(&[("title", json!("rest 2"))]),
                )
                .await
                .unwrap();
                assert_eq!(updated["title"], json!("rest 2"));
                let filtered = supabase_studio_tables_rows(
                    reference.clone(),
                    schema.clone(),
                    renamed.clone(),
                    rest_query(vec![filter("title", "in", Some("rest 2,nichts")), filter("meta", "not_null", None)]),
                )
                .await
                .unwrap();
                assert_eq!(filtered.rows.len(), 1);
                let keys = page.rows[..3]
                    .iter()
                    .map(|row| key(&[("id", row["id"].clone())]))
                    .collect::<Vec<_>>();
                assert_eq!(
                    supabase_studio_tables_delete_rows(reference.clone(), schema.clone(), renamed.clone(), keys)
                        .await
                        .unwrap(),
                    3
                );
                latency("studio tables rows data api", 500, || {
                    let (reference, schema, renamed) = (reference.clone(), schema.clone(), renamed.clone());
                    async move {
                        supabase_studio_tables_rows(reference, schema, renamed, rest_query(vec![filter("title", "ilike", Some("row*"))]))
                            .await
                            .unwrap();
                    }
                })
                .await;
                assert!(supabase_studio_tables_list(reference.clone(), String::new(), String::new(), 0)
                    .await
                    .is_err());
                supabase_connect_self_hosted(url.clone(), secret.clone(), "Lab".into())
                    .await
                    .unwrap();
            }

            supabase_studio_tables_truncate(reference.clone(), schema.clone(), renamed.clone(), true, false)
                .await
                .unwrap();
            let empty = supabase_studio_tables_rows(
                reference.clone(),
                schema.clone(),
                renamed.clone(),
                StudioRowQuery { offset: 0, sort_column: None, sort_desc: false, filters: Vec::new() },
            )
            .await
            .unwrap();
            assert!(empty.rows.is_empty());
        }))
        .await;

        supabase_connect_self_hosted(url, secret, "Lab".into())
            .await
            .unwrap();
        for name in [&table, &renamed] {
            let _ = database_execute(
                &reference,
                &format!("DROP TABLE IF EXISTS {}", qualified(&schema, name).unwrap()),
                &[],
            )
            .await;
        }
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }
}
