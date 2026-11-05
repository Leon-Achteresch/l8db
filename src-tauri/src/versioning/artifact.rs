use super::{control, runner::Request, snapshot};
use crate::db::{sql_script, DatabaseKind};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value[field]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Release-Feld {field} fehlt"))
}

fn compact(source: &str) -> String {
    let mut result = String::with_capacity(source.len());
    let mut quoted = false;
    let mut escaped = false;
    for ch in source.chars() {
        if quoted {
            result.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
        } else if ch == '"' {
            quoted = true;
            result.push(ch);
        } else if !ch.is_whitespace() {
            result.push(ch);
        }
    }
    result
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
        && value != "."
        && value != ".."
}

async fn release(root: &Path, commit: &str, id: &str) -> Result<(Value, String), String> {
    if !identifier(id) {
        return Err("Ungültige Release-ID".into());
    }
    let object = format!("{commit}:database/releases/{id}.json");
    let size = super::git(root, &["cat-file", "-s", &object]).await?;
    if size
        .trim()
        .parse::<usize>()
        .map_err(|_| "Ungültige Manifestgröße")?
        > 16 * 1024 * 1024
    {
        return Err("Release-Manifest ist zu groß".into());
    }
    let source = super::git(root, &["show", &object]).await?;
    let value: Value =
        serde_json::from_str(&source).map_err(|_| "Release-Manifest ist ungültig")?;
    if !(value["format"] == 1 || value["format"] == 2) || value["id"] != id {
        return Err("Release-Manifest passt nicht zur Referenz".into());
    }
    for item in value["migrations"].as_array().into_iter().flatten() {
        if item["checksum"] != control::hash(text(item, "sql")?) {
            return Err("Migrationsprüfsumme stimmt nicht".into());
        }
    }
    for item in value["objects"].as_array().into_iter().flatten() {
        if item["checksum"] != control::hash(text(item, "definition")?) {
            return Err("Objektprüfsumme stimmt nicht".into());
        }
    }
    Ok((value, control::hash(&compact(&source))))
}

fn objects(release: &Value, target: Option<&str>) -> Result<Value, String> {
    let mut result = Vec::new();
    for item in release["objects"]
        .as_array()
        .ok_or("Release-Objekte fehlen")?
    {
        let object = &item["object"];
        let selection = &object["selection"];
        let source = text(selection, "schema")?;
        let mut mapped = json!({
            "schema": target.unwrap_or(source), "sourceSchema": source,
            "name": text(selection, "objectName")?, "kind": text(selection, "objectType")?,
            "definition": text(item, "definition")?,
        });
        if !object["metadataVersion"].is_null() {
            mapped["metadataVersion"] = object["metadataVersion"].clone();
        }
        result.push(mapped);
    }
    Ok(json!(result))
}

fn mapped(item: &Value, target: Option<&str>, definition: Option<&str>) -> Result<Value, String> {
    let object = &item["object"];
    let selection = &object["selection"];
    let source = text(selection, "schema")?;
    let mut mapped = json!({
        "schema": target.unwrap_or(source), "sourceSchema": source,
        "name": text(selection, "objectName")?, "kind": text(selection, "objectType")?,
        "definition": definition.map(str::to_owned).map_or_else(|| text(item, "definition").map(str::to_owned), Ok)?,
    });
    if !object["metadataVersion"].is_null() {
        mapped["metadataVersion"] = object["metadataVersion"].clone();
    }
    Ok(mapped)
}

fn managed(release: &Value, target: Option<&str>) -> Result<Value, String> {
    let mut result = Vec::new();
    for item in release["objects"]
        .as_array()
        .ok_or("Release-Objekte fehlen")?
    {
        let mut entry = mapped(item, target, None)?;
        entry["id"] = json!(text(&item["object"], "id")?);
        result.push(entry);
    }
    Ok(json!(result))
}

pub(super) fn parents(release: &Value) -> Vec<String> {
    if release["format"] == 2 {
        release["parents"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p.as_str().map(str::to_owned))
            .collect()
    } else {
        release["parent"]
            .as_str()
            .map(str::to_owned)
            .into_iter()
            .collect()
    }
}

fn object_entry<'a>(release: &'a Value, id: &str) -> Option<&'a Value> {
    release["objects"]
        .as_array()?
        .iter()
        .find(|item| item["object"]["id"] == id)
}

fn touch(
    id: &str,
    owners: &[&Value],
    target: Option<&str>,
    expect: &str,
    definition: &str,
) -> Result<Value, String> {
    let item = owners
        .iter()
        .find_map(|release| object_entry(release, id))
        .ok_or_else(|| format!("Berührtes Objekt {id} ist im Release nicht beschrieben"))?;
    let mut value = mapped(item, target, Some(definition))?;
    value["id"] = json!(id);
    value["expect"] = json!(expect);
    Ok(value)
}

fn sorted(mut values: Vec<Value>) -> Vec<Value> {
    values.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    values
}

fn expected_touches(
    rules: &Value,
    source: Option<&Value>,
    parent: Option<&Value>,
    to: &Value,
    planned: &Value,
    target: Option<&str>,
) -> Result<Vec<Value>, String> {
    let owners: Vec<&Value> = source.into_iter().chain(parent).chain([to]).collect();
    let mut result = Vec::new();
    if rules.get("touches").is_none_or(Value::is_null) {
        let source = source.ok_or("Änderung ohne berührte Objekte")?;
        let empty = vec![];
        let previous = parent
            .and_then(|p| p["objects"].as_array())
            .unwrap_or(&empty);
        let current = source["objects"]
            .as_array()
            .ok_or("Release-Objekte fehlen")?;
        let mut ids: Vec<&str> = previous
            .iter()
            .chain(current)
            .filter_map(|item| item["object"]["id"].as_str())
            .collect();
        ids.sort();
        ids.dedup();
        for id in ids {
            let old = parent.and_then(|p| object_entry(p, id));
            let new = object_entry(source, id);
            if old.map(|o| &o["checksum"]) == new.map(|n| &n["checksum"]) {
                continue;
            }
            result.push(match old {
                Some(old) => touch(id, &owners, target, "definition", text(old, "definition")?)?,
                None => touch(id, &owners, target, "absent", "")?,
            });
        }
        return Ok(sorted(result));
    }
    let declared = rules["touches"].as_array().ok_or("touches ist ungültig")?;
    let planned_touches = planned["touches"]
        .as_array()
        .ok_or("Berührte Objekte fehlen")?;
    for id in declared {
        let id = id.as_str().ok_or("touches ist ungültig")?;
        let before = &rules["before"][id];
        result.push(if before.is_null() && rules["before"].get(id).is_some() {
            touch(id, &owners, target, "absent", "")?
        } else if let Some(hash) = before.as_str() {
            let definition = planned_touches
                .iter()
                .find(|t| t["id"] == id)
                .and_then(|t| t["definition"].as_str())
                .ok_or("Vorher-Stand fehlt im Ausführungsplan")?;
            if control::hash(definition) != hash {
                return Err(format!("Vorher-Stand von {id} passt nicht zur Änderung"));
            }
            touch(id, &owners, target, "definition", definition)?
        } else {
            touch(id, &owners, target, "check", "")?
        });
    }
    Ok(sorted(result))
}

fn mapped_checks(checks: &Value, release: &Value, target: Option<&str>) -> Result<Value, String> {
    let mut result = Vec::new();
    for check in checks.as_array().into_iter().flatten() {
        let sql = text(check, "sql")?;
        if check["checksum"] != control::hash(sql) {
            return Err("Prüfanweisungs-Prüfsumme stimmt nicht".into());
        }
        let mut mapped = check.clone();
        mapped["sql"] = json!(map_sql(sql, release, target)?);
        result.push(mapped);
    }
    Ok(json!(result))
}

fn map_sql(sql: &str, release: &Value, target: Option<&str>) -> Result<String, String> {
    let Some(target) = target else {
        return Ok(sql.into());
    };
    let schemas: HashSet<_> = release["objects"]
        .as_array()
        .ok_or("Release-Objekte fehlen")?
        .iter()
        .map(|object| {
            object["object"]["selection"]["schema"]
                .as_str()
                .unwrap_or("")
        })
        .collect();
    if schemas.len() != 1 || schemas.contains("") {
        return Err("Schema-Zuordnung ist nicht eindeutig".into());
    }
    Ok(snapshot::requalify(
        sql,
        schemas.into_iter().next().unwrap(),
        target,
    ))
}

fn split(kind: DatabaseKind, sql: &str) -> Result<Vec<String>, String> {
    if kind != DatabaseKind::Oracle {
        return Ok(sql_script::split_for(kind, sql));
    }
    let mut statements = Vec::new();
    for (sqlplus, statement) in crate::db::oracle::script_items(sql) {
        if !sqlplus {
            statements.push(statement);
        } else if statement.trim() != "/" {
            return Err("SQL*Plus-Befehle sind in verwalteten Migrationen nicht zulässig".into());
        }
    }
    Ok(statements)
}

fn statement_key(sql: &str) -> &str {
    let sql = sql.trim();
    sql.strip_suffix(';').unwrap_or(sql).trim_end()
}

pub(super) async fn standalone(
    root: &Path,
    commit: &str,
    id: &str,
) -> Result<(Value, String), String> {
    if !identifier(id) {
        return Err("Ungültige Änderungs-ID".into());
    }
    let manifest = super::git(
        root,
        &["show", &format!("{commit}:database/changes/{id}.json")],
    )
    .await
    .map_err(|_| format!("Änderung {id} ist im geplanten Git-Stand nicht committet"))?;
    let sql = super::git(
        root,
        &["show", &format!("{commit}:database/changes/{id}.sql")],
    )
    .await
    .map_err(|_| format!("SQL der Änderung {id} ist im geplanten Git-Stand nicht committet"))?;
    let value: Value =
        serde_json::from_str(&manifest).map_err(|_| "Änderungsdatei ist ungültig")?;
    let sql = sql
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim_end()
        .to_string();
    if value["format"] != 1 || value["id"] != id || value["checksum"] != control::hash(&sql) {
        return Err(format!("Änderung {id} passt nicht zu ihrer Prüfsumme"));
    }
    Ok((value, sql))
}

pub(super) struct Context<'a> {
    pub root: &'a Path,
    pub commit: &'a str,
    pub to: &'a Value,
    pub parent: Option<&'a Value>,
    pub target: Option<&'a str>,
    pub kind: DatabaseKind,
    pub change: Option<&'a str>,
    pub additive: bool,
}

fn destructive(sql: &str) -> bool {
    let upper = sql.to_uppercase();
    let tokens: Vec<&str> = upper
        .split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '#')))
        .filter(|token| !token.is_empty())
        .collect();
    tokens
        .iter()
        .any(|token| matches!(*token, "DROP" | "TRUNCATE" | "MODIFY"))
        || (tokens.contains(&"ALTER") && tokens.contains(&"TYPE"))
}

async fn verify_changes(source: &Value, plan: &Value, context: &Context<'_>) -> Result<(), String> {
    let id = text(source, "id")?;
    let mut statements = Vec::new();
    let changes = plan["changes"]
        .as_array()
        .ok_or("Änderungen fehlen im Ausführungsplan")?;
    let mut seen = HashSet::new();
    for change in changes {
        let change_id = text(change, "id")?;
        if !seen.insert(change_id.to_string()) {
            return Err("Änderung doppelt im Ausführungsplan".into());
        }
        let embedded = change_id
            .strip_prefix(id)
            .and_then(|rest| rest.strip_prefix('/'));
        let (rules, sql, owner, prefix, scope) = if let Some(migration) = embedded {
            let rules = source["migrations"]
                .as_array()
                .ok_or("Migrationen fehlen")?
                .iter()
                .find(|m| m["id"] == migration)
                .ok_or_else(|| format!("Änderung {change_id} fehlt im Release"))?
                .clone();
            let sql = text(&rules, "sql")?.to_string();
            (
                rules,
                sql,
                Some(source),
                format!("{id}:{migration}"),
                source,
            )
        } else {
            if context.change != Some(change_id)
                && !source["changes"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|entry| entry == change_id))
            {
                return Err(format!("Änderung {change_id} gehört nicht zu Release {id}"));
            }
            let (rules, sql) = standalone(context.root, context.commit, change_id).await?;
            (rules, sql, None, change_id.to_string(), context.to)
        };
        let kind = rules["kind"].as_str().unwrap_or("versioned");
        if !["versioned", "repeatable"].contains(&kind)
            || change["kind"] != kind
            || change["checksum"] != control::hash(&sql)
            || change["requires"] != rules.get("requires").cloned().unwrap_or(json!([]))
        {
            return Err(format!(
                "Änderung {change_id} weicht vom committeten Stand ab"
            ));
        }
        let touches = expected_touches(
            &rules,
            owner,
            context.parent,
            context.to,
            change,
            context.target,
        )?;
        if sorted(change["touches"].as_array().cloned().unwrap_or_default()) != touches {
            return Err(format!(
                "Berührte Objekte von {change_id} weichen vom committeten Stand ab"
            ));
        }
        for phase in ["preconditions", "postconditions"] {
            if change[phase] != mapped_checks(&rules[phase], scope, context.target)? {
                return Err("Prüfanweisungen wurden im Ausführungsplan verändert".into());
            }
        }
        let sql = map_sql(&sql, scope, context.target)?;
        let pieces = split(context.kind, &sql)?;
        if context.additive
            && rules["destructive"] != true
            && pieces.iter().any(|piece| destructive(piece))
        {
            return Err(format!(
                "Nur additiv: {change_id} enthält Entfernungen oder Typwechsel ohne ausdrückliche Freigabe"
            ));
        }
        for (index, sql) in pieces.into_iter().enumerate() {
            statements.push(json!({"id":format!("{prefix}:{}", index + 1), "migration":change_id, "sql":statement_key(&sql)}));
        }
    }
    let planned: Vec<Value> = plan["statements"]
        .as_array()
        .ok_or("SQL-Anweisungen fehlen")?
        .iter()
        .map(|item| {
            let sql = item["sql"].as_str().ok_or("SQL-Anweisung ist ungültig")?;
            let mut item = item.clone();
            item["sql"] = json!(statement_key(sql));
            Ok(item)
        })
        .collect::<Result<_, String>>()?;
    if planned != statements {
        return Err("SQL-Anweisungen stimmen nicht mit dem committeten Release überein".into());
    }
    Ok(())
}

async fn verify_plan(
    release: &Value,
    hash: &str,
    plan: &Value,
    context: &Context<'_>,
) -> Result<(), String> {
    let target = context.target;
    let kind = context.kind;
    let id = text(release, "id")?;
    if plan["id"] != id || plan["hash"] != hash || plan["objects"] != objects(release, target)? {
        return Err("Ausführungsplan weicht vom committeten Release ab".into());
    }
    verify_changes(release, plan, context).await?;
    for phase in ["preconditions", "postconditions"] {
        if plan[phase] != mapped_checks(&release["safety"][phase], release, target)? {
            return Err("Prüfanweisungen wurden im Ausführungsplan verändert".into());
        }
    }
    let safety = &release["safety"];
    let lock = safety["lockTimeoutMs"].as_u64().unwrap_or(5000);
    let timeout = safety["statementTimeoutMs"].as_u64().unwrap_or(60000);
    if lock == 0
        || lock > 600_000
        || timeout == 0
        || timeout > 3_600_000
        || plan["oracleTimeout"] != timeout
    {
        return Err("Ungültige Sitzungsgrenzen im Ausführungsplan".into());
    }
    let schemas: HashSet<_> = release["objects"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|object| target.or_else(|| object["object"]["selection"]["schema"].as_str()))
        .collect();
    let schema = if schemas.len() == 1 {
        control::quote(schemas.iter().next().unwrap())
    } else {
        "pg_catalog".into()
    };
    let settings = if kind == DatabaseKind::Postgres {
        vec![
            format!("SET LOCAL lock_timeout = '{lock}ms'"),
            format!("SET LOCAL statement_timeout = '{timeout}ms'"),
            format!(
                "SET LOCAL idle_in_transaction_session_timeout = '{}ms'",
                timeout.max(60000)
            ),
            format!("SET LOCAL search_path = {schema}, pg_temp"),
            "SET LOCAL row_security = off".into(),
        ]
    } else if schemas.len() == 1 {
        vec![
            format!("ALTER SESSION SET CURRENT_SCHEMA = {schema}"),
            format!(
                "ALTER SESSION SET DDL_LOCK_TIMEOUT = {}",
                lock.div_ceil(1000)
            ),
        ]
    } else {
        return Err("Oracle benötigt genau ein Zielschema".into());
    };
    if plan["settings"] != json!(settings) {
        return Err("Sitzungseinstellungen wurden im Ausführungsplan verändert".into());
    }
    Ok(())
}

pub async fn verify(request: &Request) -> Result<(), String> {
    if request.artifact.len() > 16 * 1024 * 1024 {
        return Err("Freigabeartefakt ist zu groß".into());
    }
    let artifact: Value =
        serde_json::from_str(&request.artifact).map_err(|_| "Freigabeartefakt ist ungültig")?;
    let plan = &artifact["execution"];
    let commit = text(&plan["reference"], "commit")?;
    if ![40, 64].contains(&commit.len()) || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Vollständige Git-Commit-ID fehlt".into());
    }
    let directory = std::fs::canonicalize(&request.repo).map_err(|_| "Release-Repository fehlt")?;
    let root = std::path::PathBuf::from(
        super::git(&directory, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    if super::revision(&root, commit).await? != commit {
        return Err("Git-Referenz ist nicht eindeutig".into());
    }
    let organization = crate::organization::current(false)?;
    if organization.policy.require_signed_releases {
        super::git(&root, &["verify-commit", commit])
            .await
            .map_err(|_| "Release-Commit hat keine gültige Signatur")?;
        let fingerprint =
            super::git(&root, &["show", "--no-patch", "--format=%GF", commit]).await?;
        if !organization
            .policy
            .trusted_release_signers
            .iter()
            .any(|signer| signer == fingerprint.trim())
        {
            return Err(
                "Release-Commit stammt nicht von einem durch die IT freigegebenen Signierer".into(),
            );
        }
    }
    let target = artifact["schema"]
        .as_str()
        .filter(|schema| !schema.is_empty());
    let (from, from_hash) = release(&root, commit, text(plan, "fromId")?).await?;
    if from["projectId"] != request.connection.project_id {
        return Err("Ausgangsrelease gehört nicht zum Projekt".into());
    }
    if plan["format"] != 2 {
        return Err("Ausführungsplan stammt von einer älteren l8db-Version. Neu planen.".into());
    }
    if plan["fromHash"] != from_hash || plan["fromObjects"] != objects(&from, target)? {
        return Err("Ausgangsrelease wurde im Ausführungsplan verändert".into());
    }
    let change = match plan.get("mode").and_then(Value::as_str) {
        None => None,
        Some("change") => Some(text(plan, "change")?),
        Some(_) => return Err("Unbekannter Ausführungsmodus".into()),
    };
    let to_id = if let Some(change) = change {
        if plan["reference"]["id"] != change
            || plan["reference"]["path"] != format!("database/changes/{change}.json")
        {
            return Err("Änderung stimmt nicht mit dem Ausführungsplan überein".into());
        }
        text(plan, "fromId")?
    } else {
        let to_id = text(&plan["reference"], "id")?;
        if plan["reference"]["path"] != format!("database/releases/{to_id}.json") {
            return Err("Zielrelease stimmt nicht mit dem Ausführungsplan überein".into());
        }
        to_id
    };
    let mut cache: std::collections::HashMap<String, (Value, String)> = Default::default();
    let (to, _) = release(&root, commit, to_id).await?;
    let soll = managed(&to, target)?;
    if plan["objects"] != soll {
        return Err("Sollstand im Ausführungsplan weicht vom Zielrelease ab".into());
    }
    for variance in plan["variances"]
        .as_array()
        .ok_or("Festgehaltene Abweichungen fehlen im Ausführungsplan")?
    {
        let entry = soll
            .as_array()
            .and_then(|items| items.iter().find(|item| item["id"] == variance["id"]))
            .ok_or("Festgehaltene Abweichung betrifft kein verwaltetes Objekt")?;
        let mut expected = entry.clone();
        expected["definition"] = variance["definition"].clone();
        if !variance["definition"].is_string() || *variance != expected {
            return Err("Festgehaltene Abweichung wurde im Ausführungsplan verändert".into());
        }
    }
    if let Some(overrides) = plan.get("overrides") {
        let overrides = overrides
            .as_array()
            .ok_or("Überschreiben-Freigaben sind ungültig")?;
        if overrides.iter().any(|id| {
            !soll
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item["id"] == *id))
        }) {
            return Err("Überschreiben-Freigabe betrifft kein verwaltetes Objekt".into());
        }
    }
    let releases = plan["releases"]
        .as_array()
        .filter(|items| !items.is_empty() && items.len() <= 1000)
        .ok_or("Release-Kette fehlt oder ist zu lang")?;
    if releases.last().map(|r| &r["id"]) != Some(&json!(to_id)) {
        return Err("Zielrelease stimmt nicht mit dem Ausführungsplan überein".into());
    }
    if let Some(change) = change {
        let changes = releases[0]["changes"].as_array();
        if releases.len() != 1
            || changes.map(Vec::len) != Some(1)
            || changes.and_then(|c| c[0]["id"].as_str()) != Some(change)
            || changes.is_some_and(|c| c[0]["kind"] != "versioned")
        {
            return Err(
                "Eine Einzeländerung wird allein und nur als versionierte Änderung ausgerollt"
                    .into(),
            );
        }
    }
    let mut queue = vec![to_id.to_string()];
    while let Some(id) = queue.pop() {
        if cache.contains_key(&id) {
            continue;
        }
        if cache.len() >= 5000 {
            return Err("Release-Historie ist zu groß".into());
        }
        let loaded = release(&root, commit, &id).await?;
        queue.extend(parents(&loaded.0));
        cache.insert(id, loaded);
    }
    for entry in plan
        .get("ahead")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let object = text(entry, "object")?;
        let change_id = text(entry, "change")?;
        let (rules, _) = standalone(&root, commit, change_id).await?;
        if change == Some(change_id)
            || !rules["touches"]
                .as_array()
                .is_some_and(|touches| touches.iter().any(|t| t == object))
            || cache.values().any(|(value, _)| {
                value["changes"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|id| id == change_id))
            })
        {
            return Err(format!(
                "Vorgezogene Änderung {change_id} ist im Ausführungsplan ungültig"
            ));
        }
    }
    let ancestors = |id: &str| {
        let mut seen = HashSet::new();
        let mut stack = vec![id.to_string()];
        while let Some(current) = stack.pop() {
            if seen.insert(current.clone()) {
                if let Some((value, _)) = cache.get(&current) {
                    stack.extend(parents(value));
                }
            }
        }
        seen
    };
    let additive =
        match super::git(&root, &["show", &format!("{commit}:database/project.json")]).await {
            Ok(text) => {
                serde_json::from_str::<Value>(&text)
                    .map_err(|_| "database/project.json im freigegebenen Commit ist ungültig")?
                    ["additiveOnly"]
                    == true
            }
            Err(_) => false,
        };
    let mut done: HashSet<String> = HashSet::new();
    for planned in releases {
        let id = text(planned, "id")?;
        let Some((source, hash)) = cache.get(id) else {
            return Err("Release-Kette gehört nicht zum Projekt oder Ausgangsrelease".into());
        };
        if done.contains(id)
            || source["projectId"] != request.connection.project_id
            || source["kind"]
                != serde_json::to_value(request.connection.kind).map_err(|e| e.to_string())?
        {
            return Err("Release-Kette gehört nicht zum Projekt oder Ausgangsrelease".into());
        }
        let later: Vec<&str> = releases
            .iter()
            .skip_while(|entry| entry["id"] != id)
            .skip(1)
            .filter_map(|entry| entry["id"].as_str())
            .collect();
        let own = ancestors(id);
        if later.iter().any(|entry| own.contains(*entry)) {
            return Err("Zyklische Release-Kette".into());
        }
        let parent = parents(source)
            .first()
            .and_then(|p| cache.get(p))
            .map(|(v, _)| v);
        let context = Context {
            root: &root,
            commit,
            to: &to,
            parent,
            target,
            kind: request.connection.kind,
            change,
            additive,
        };
        verify_plan(source, hash, planned, &context).await?;
        done.insert(id.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn additive_rule_detects_drops_and_type_changes() {
        assert!(destructive("ALTER TABLE t DROP COLUMN a"));
        assert!(destructive("alter table t alter column a type bigint"));
        assert!(destructive("ALTER TABLE T MODIFY (A VARCHAR2(5))"));
        assert!(destructive("ALTER TABLE t ALTER COLUMN \"a\" TYPE bigint"));
        assert!(destructive("ALTER TABLE t ALTER a\n  TYPE bigint"));
        assert!(destructive(
            "ALTER TABLE t ALTER COLUMN a SET DATA TYPE bigint"
        ));
        assert!(destructive("-- Typ\nALTER TABLE t ALTER a TYPE bigint"));
        assert!(!destructive(
            "ALTER TABLE t ADD COLUMN dropped_at timestamp"
        ));
        assert!(!destructive("CREATE INDEX i ON t (a)"));
    }

    #[tokio::test]
    async fn committed_artifact_is_verified_before_any_database_is_opened() {
        let root = tempfile::tempdir().unwrap();
        super::super::git(root.path(), &["init", "-b", "main"])
            .await
            .unwrap();
        super::super::git(
            root.path(),
            &["config", "user.email", "test@example.invalid"],
        )
        .await
        .unwrap();
        super::super::git(root.path(), &["config", "user.name", "Test"])
            .await
            .unwrap();
        std::fs::create_dir_all(root.path().join("database/releases")).unwrap();
        let from = json!({"format":1,"id":"r1","projectId":"test","kind":"postgres","parent":null,
            "objects":[{"object":{"id":"t","selection":{"schema":"public","objectName":"t","objectType":"table"}},"definition":"id integer","checksum":control::hash("id integer")}],"migrations":[]});
        let mut next = from.clone();
        next["id"] = json!("r2");
        next["parent"] = json!("r1");
        next["migrations"] = json!([{"id":"m1","sql":"ALTER TABLE public.t ADD name text","checksum":control::hash("ALTER TABLE public.t ADD name text")}]);
        next["objects"][0]["definition"] = json!("id integer\nname text");
        next["objects"][0]["checksum"] = json!(control::hash("id integer\nname text"));
        for source in [&from, &next] {
            std::fs::write(
                root.path().join(format!(
                    "database/releases/{}.json",
                    source["id"].as_str().unwrap()
                )),
                serde_json::to_string(source).unwrap(),
            )
            .unwrap();
        }
        super::super::git(root.path(), &["add", "database"])
            .await
            .unwrap();
        super::super::git(
            root.path(),
            &["-c", "commit.gpgsign=false", "commit", "-m", "test"],
        )
        .await
        .unwrap();
        let commit = super::super::git(root.path(), &["rev-parse", "HEAD"])
            .await
            .unwrap()
            .trim()
            .to_string();
        let touches = vec![
            json!({"id":"t","expect":"definition","schema":"public","sourceSchema":"public","name":"t","kind":"table","definition":"id integer"}),
        ];
        let plan = json!({"format":2,"fromId":"r1","fromHash":control::hash(&from.to_string()),"fromObjects":objects(&from,None).unwrap(),
            "reference":{"id":"r2","commit":commit,"path":"database/releases/r2.json"},
            "objects":managed(&next,None).unwrap(),"variances":[],
            "releases":[{"id":"r2","hash":control::hash(&next.to_string()),"objects":objects(&next,None).unwrap(),
                "statements":[{"id":"r2:m1:1","migration":"r2/m1","sql":"ALTER TABLE public.t ADD name text"}],
                "changes":[{"id":"r2/m1","checksum":control::hash("ALTER TABLE public.t ADD name text"),"kind":"versioned","requires":[],"touches":touches,"preconditions":[],"postconditions":[]}],
                "preconditions":[],"postconditions":[],"oracleTimeout":60000,
                "settings":["SET LOCAL lock_timeout = '5000ms'","SET LOCAL statement_timeout = '60000ms'","SET LOCAL idle_in_transaction_session_timeout = '60000ms'","SET LOCAL search_path = \"public\", pg_temp","SET LOCAL row_security = off"]}]});
        let request = Request {
            connection: super::super::control::Connection {
                kind: DatabaseKind::Postgres,
                connection_string: "postgres://unreachable.invalid/db".into(),
                database: None,
                schema: "control".into(),
                project_id: "test".into(),
                read_only: false,
            },
            repo: root.path().to_string_lossy().into_owned(),
            target_id: "target".into(),
            run_id: "run".into(),
            artifact: json!({"schema":null,"execution":plan}).to_string(),
            promotion: Vec::new(),
        };
        verify(&request).await.unwrap();
        let mut altered: Value = serde_json::from_str(&request.artifact).unwrap();
        altered["execution"]["releases"][0]["statements"][0]["sql"] = json!("DROP DATABASE other");
        let mut request = request;
        request.artifact = altered.to_string();
        assert!(verify(&request)
            .await
            .unwrap_err()
            .contains("SQL-Anweisungen"));
    }

    #[test]
    fn artifact_json_compaction_has_bounded_latency_for_large_release_manifests() {
        let source = serde_json::to_string_pretty(&json!({"migrations":(0..2000).map(|index| json!({"id":index,"sql":"ALTER TABLE public.example ADD name text","checksum":"x".repeat(64)})).collect::<Vec<_>>()})).unwrap();
        let mut times = Vec::new();
        for _ in 0..15 {
            let start = std::time::Instant::now();
            let compacted = compact(&source);
            assert!(compacted.len() <= source.len());
            assert_eq!(
                serde_json::from_str::<Value>(&compacted).unwrap()["migrations"]
                    .as_array()
                    .unwrap()
                    .len(),
                2000
            );
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        eprintln!("artifact-json: migrations=2000 input_bytes={} median_ms={} p95_ms={} database_requests=0",source.len(),times[7],times[14]);
        assert!(times[14] < 150.0);
        assert!(source.len() < 1024 * 1024);
    }

    fn context<'a>(
        root: &'a Path,
        to: &'a Value,
        parent: Option<&'a Value>,
        kind: DatabaseKind,
    ) -> Context<'a> {
        Context {
            root,
            commit: "0",
            to,
            parent,
            target: None,
            kind,
            change: None,
            additive: false,
        }
    }

    #[tokio::test]
    async fn source_plan_rejects_changed_sql_checks_settings_and_snapshots() {
        let parent = json!({"id":"r1","objects":[{"object":{"id":"t","selection":{"schema":"public","objectName":"t","objectType":"table"}},"definition":"id integer","checksum":"a"}],"migrations":[]});
        let release = json!({"id":"r2","objects":[{"object":{"id":"t","selection":{"schema":"public","objectName":"t","objectType":"table"}},"definition":"id integer\nname text","checksum":"b"}],
            "migrations":[{"id":"m1","sql":"ALTER TABLE public.t ADD name text"}]});
        let plan = json!({"id":"r2","hash":"hash","objects":objects(&release,None).unwrap(),
            "statements":[{"id":"r2:m1:1","migration":"r2/m1","sql":"ALTER TABLE public.t ADD name text"}],
            "changes":[{"id":"r2/m1","checksum":control::hash("ALTER TABLE public.t ADD name text"),"kind":"versioned","requires":[],
                "touches":[{"id":"t","expect":"definition","schema":"public","sourceSchema":"public","name":"t","kind":"table","definition":"id integer"}],"preconditions":[],"postconditions":[]}],
            "preconditions":[],"postconditions":[],"oracleTimeout":60000,
            "settings":["SET LOCAL lock_timeout = '5000ms'","SET LOCAL statement_timeout = '60000ms'","SET LOCAL idle_in_transaction_session_timeout = '60000ms'","SET LOCAL search_path = \"public\", pg_temp","SET LOCAL row_security = off"]});
        let root = Path::new(".");
        let ctx = context(root, &release, Some(&parent), DatabaseKind::Postgres);
        verify_plan(&release, "hash", &plan, &ctx).await.unwrap();
        for key in [
            "statements",
            "preconditions",
            "settings",
            "objects",
            "hash",
            "changes",
        ] {
            let mut altered = plan.clone();
            altered[key] = json!("tampered");
            assert!(verify_plan(&release, "hash", &altered, &ctx).await.is_err());
        }
        let mut altered = plan.clone();
        altered["changes"][0]["touches"][0]["definition"] = json!("id bigint");
        assert!(verify_plan(&release, "hash", &altered, &ctx).await.is_err());
        let mut altered = plan.clone();
        altered["changes"][0]["touches"] = json!([]);
        assert!(verify_plan(&release, "hash", &altered, &ctx).await.is_err());
        assert_eq!(
            compact("{\n \"sql\": \"a b\\\"c\" }"),
            "{\"sql\":\"a b\\\"c\"}"
        );
    }

    #[tokio::test]
    async fn plan_statements_match_the_frontend_splitter_output() {
        let check = |kind, sql: &str, planned: Vec<&str>| {
            let release = json!({"id":"r2","objects":[],"migrations":[{"id":"m1","sql":sql,"touches":[],"before":{}}]});
            let statements: Vec<Value> = planned
                .iter()
                .enumerate()
                .map(|(index, sql)| json!({"id":format!("r2:m1:{}", index + 1),"migration":"r2/m1","sql":sql}))
                .collect();
            let plan = json!({"statements":statements,"changes":[{"id":"r2/m1","checksum":control::hash(sql),"kind":"versioned","requires":[],"touches":[],"preconditions":[],"postconditions":[]}]});
            async move {
                let root = Path::new(".");
                let ctx = context(root, &release, None, kind);
                verify_changes(&release, &plan, &ctx).await
            }
        };
        check(
            DatabaseKind::Postgres,
            "ALTER TABLE public.t ADD note text;\nCREATE INDEX t_note ON public.t(note);",
            vec![
                "ALTER TABLE public.t ADD note text;",
                "CREATE INDEX t_note ON public.t(note);",
            ],
        )
        .await
        .unwrap();
        check(
            DatabaseKind::Oracle,
            "ALTER TABLE T ADD (X NUMBER);\nCREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q;\nEND;\n/",
            vec![
                "ALTER TABLE T ADD (X NUMBER);",
                "CREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q;\nEND;",
            ],
        )
        .await
        .unwrap();
        assert!(check(
            DatabaseKind::Postgres,
            "ALTER TABLE public.t ADD note text;",
            vec!["ALTER TABLE public.t ADD note text; DROP TABLE public.t;"],
        )
        .await
        .is_err());
        assert!(check(
            DatabaseKind::Postgres,
            "ALTER TABLE public.t ADD note text;",
            vec!["ALTER TABLE public.t ADD note text;;"],
        )
        .await
        .is_err());
        assert!(check(
            DatabaseKind::Oracle,
            "ALTER TABLE T ADD (X NUMBER);\n@more.sql",
            vec!["ALTER TABLE T ADD (X NUMBER);"],
        )
        .await
        .is_err());
        assert!(check(
            DatabaseKind::Oracle,
            "CREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q;\nEND;\n/",
            vec!["CREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q", "END"],
        )
        .await
        .is_err());
    }
}
