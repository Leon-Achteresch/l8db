use super::qualified;
use crate::supabase::{database_execute, database_query, quote_identifier, validate_ref};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const PAGE: usize = 100;
const MAX_OFFSET: u32 = 100_000;

const SYSTEM_SCHEMAS: &[&str] = &[
    "auth",
    "storage",
    "realtime",
    "_realtime",
    "_analytics",
    "extensions",
    "graphql",
    "graphql_public",
    "vault",
    "pgsodium",
    "pgsodium_masks",
    "supabase_functions",
    "supabase_migrations",
    "net",
    "cron",
    "pgbouncer",
    "pgtle",
    "information_schema",
];

const SYSTEM_ROLES: &[&str] = &[
    "postgres",
    "anon",
    "authenticated",
    "authenticator",
    "service_role",
    "dashboard_user",
    "pgbouncer",
    "pgsodium_keyholder",
    "pgsodium_keyiduser",
    "pgsodium_keymaker",
];

const INDEX_METHODS: &[&str] = &["btree", "hash", "gist", "spgist", "gin", "brin"];
const POLICY_COMMANDS: &[&str] = &["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"];

#[derive(Debug, Serialize)]
pub struct DatabaseListPage {
    pub items: Vec<Value>,
    pub has_more: bool,
}

#[derive(Debug, Default, Deserialize)]
pub struct RoleAttributes {
    pub login: bool,
    pub inherit: bool,
    pub createdb: bool,
    pub createrole: bool,
    pub bypassrls: bool,
    pub connection_limit: i32,
}

#[derive(Debug, Deserialize)]
pub struct PolicyInput {
    pub name: String,
    pub command: String,
    pub permissive: bool,
    pub roles: Vec<String>,
    pub using_expression: String,
    pub check_expression: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DatabaseAction {
    CreateSchema {
        name: String,
    },
    DropSchema {
        name: String,
        cascade: bool,
    },
    RefreshView {
        schema: String,
        name: String,
    },
    DropView {
        schema: String,
        name: String,
        materialized: bool,
        cascade: bool,
    },
    DropFunction {
        oid: u32,
        cascade: bool,
    },
    SetTrigger {
        schema: String,
        table: String,
        name: String,
        enabled: bool,
    },
    DropTrigger {
        schema: String,
        table: String,
        name: String,
    },
    CreateIndex {
        schema: String,
        table: String,
        name: String,
        columns: Vec<String>,
        method: String,
        unique: bool,
        concurrently: bool,
    },
    DropIndex {
        schema: String,
        name: String,
        concurrently: bool,
    },
    CreateEnum {
        schema: String,
        name: String,
        values: Vec<String>,
    },
    AddEnumValue {
        schema: String,
        name: String,
        value: String,
    },
    RenameEnumValue {
        schema: String,
        name: String,
        from: String,
        to: String,
    },
    DropEnum {
        schema: String,
        name: String,
        cascade: bool,
    },
    EnableExtension {
        name: String,
        schema: String,
    },
    DisableExtension {
        name: String,
        cascade: bool,
    },
    CreateRole {
        name: String,
        attributes: RoleAttributes,
        password: String,
    },
    AlterRole {
        name: String,
        attributes: RoleAttributes,
    },
    SetRolePassword {
        name: String,
        password: String,
    },
    DropRole {
        name: String,
    },
    SetPublicationTable {
        publication: String,
        schema: String,
        table: String,
        add: bool,
    },
    SetPublicationActions {
        publication: String,
        insert: bool,
        update: bool,
        delete: bool,
        truncate: bool,
    },
    ResetSequence {
        schema: String,
        name: String,
        value: i64,
    },
    SetRls {
        schema: String,
        table: String,
        mode: String,
    },
    CreatePolicy {
        schema: String,
        table: String,
        policy: PolicyInput,
    },
    UpdatePolicy {
        schema: String,
        table: String,
        original: String,
        policy: PolicyInput,
    },
    DropPolicy {
        schema: String,
        table: String,
        name: String,
    },
}

fn literal(value: &str) -> Result<String, String> {
    if value.contains('\0') || value.len() > 1024 {
        return Err("Ungültiger Wert.".into());
    }
    Ok(format!("'{}'", value.replace('\'', "''")))
}

fn is_system_schema(name: &str) -> bool {
    name.starts_with("pg_") || SYSTEM_SCHEMAS.contains(&name)
}

fn is_system_role(name: &str) -> bool {
    name.starts_with("pg_") || name.starts_with("supabase_") || SYSTEM_ROLES.contains(&name)
}

fn cascade(enabled: bool) -> &'static str {
    if enabled {
        " CASCADE"
    } else {
        ""
    }
}

fn flag(enabled: bool, on: &'static str, off: &'static str) -> &'static str {
    if enabled {
        on
    } else {
        off
    }
}

fn role_options(attributes: &RoleAttributes) -> Result<String, String> {
    if attributes.connection_limit < -1 {
        return Err("Ungültiges Verbindungslimit.".into());
    }
    Ok(format!(
        "{} {} {} {} {} CONNECTION LIMIT {}",
        flag(attributes.login, "LOGIN", "NOLOGIN"),
        flag(attributes.inherit, "INHERIT", "NOINHERIT"),
        flag(attributes.createdb, "CREATEDB", "NOCREATEDB"),
        flag(attributes.createrole, "CREATEROLE", "NOCREATEROLE"),
        flag(attributes.bypassrls, "BYPASSRLS", "NOBYPASSRLS"),
        attributes.connection_limit
    ))
}

fn editable_role(name: &str) -> Result<String, String> {
    if is_system_role(name) {
        return Err("Supabase-Systemrollen können nicht geändert werden.".into());
    }
    quote_identifier(name)
}

fn password(value: &str) -> Result<String, String> {
    if value.len() < 8 {
        return Err("Das Passwort muss mindestens 8 Zeichen lang sein.".into());
    }
    literal(value)
}

fn expression(value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.contains(';') || value.contains("--") || value.contains("/*") || value.len() > 4000 {
        return Err("Ausdrücke dürfen kein Semikolon und keine Kommentare enthalten.".into());
    }
    Ok(Some(format!("({value})")))
}

fn policy_roles(roles: &[String]) -> Result<String, String> {
    if roles.is_empty() {
        return Ok("public".into());
    }
    roles
        .iter()
        .map(|role| {
            if role == "public" {
                Ok("public".to_string())
            } else {
                quote_identifier(role)
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|roles| roles.join(", "))
}

fn policy_command(command: &str) -> Result<&str, String> {
    POLICY_COMMANDS
        .iter()
        .find(|known| known.eq_ignore_ascii_case(command))
        .copied()
        .ok_or_else(|| "Unbekannter Befehl für die Richtlinie.".to_string())
}

fn policy_clauses(policy: &PolicyInput) -> Result<(String, String), String> {
    let command = policy_command(&policy.command)?;
    let using = expression(&policy.using_expression)?;
    let check = expression(&policy.check_expression)?;
    if command == "INSERT" && using.is_some() {
        return Err("INSERT-Richtlinien unterstützen nur WITH CHECK.".into());
    }
    if matches!(command, "SELECT" | "DELETE") && check.is_some() {
        return Err("SELECT- und DELETE-Richtlinien unterstützen nur USING.".into());
    }
    if using.is_none() && check.is_none() {
        return Err("Die Richtlinie braucht einen USING- oder WITH-CHECK-Ausdruck.".into());
    }
    Ok((
        using
            .map(|value| format!(" USING {value}"))
            .unwrap_or_default(),
        check
            .map(|value| format!(" WITH CHECK {value}"))
            .unwrap_or_default(),
    ))
}

fn create_policy_sql(schema: &str, table: &str, policy: &PolicyInput) -> Result<String, String> {
    let (using, check) = policy_clauses(policy)?;
    Ok(format!(
        "CREATE POLICY {} ON {} AS {} FOR {} TO {}{using}{check}",
        quote_identifier(&policy.name)?,
        qualified(schema, table)?,
        flag(policy.permissive, "PERMISSIVE", "RESTRICTIVE"),
        policy_command(&policy.command)?,
        policy_roles(&policy.roles)?
    ))
}

fn action_sql(action: &DatabaseAction) -> Result<String, String> {
    Ok(match action {
        DatabaseAction::CreateSchema { name } => {
            format!("CREATE SCHEMA {}", quote_identifier(name)?)
        }
        DatabaseAction::DropSchema { name, cascade: all } => {
            if is_system_schema(name) || name == "public" {
                return Err("Dieses Schema wird von Supabase verwaltet.".into());
            }
            format!("DROP SCHEMA {}{}", quote_identifier(name)?, cascade(*all))
        }
        DatabaseAction::RefreshView { schema, name } => {
            format!("REFRESH MATERIALIZED VIEW {}", qualified(schema, name)?)
        }
        DatabaseAction::DropView {
            schema,
            name,
            materialized,
            cascade: all,
        } => format!(
            "DROP {}VIEW {}{}",
            flag(*materialized, "MATERIALIZED ", ""),
            qualified(schema, name)?,
            cascade(*all)
        ),
        DatabaseAction::DropFunction { oid, cascade: all } => format!(
            "DO $l8db$ BEGIN EXECUTE format('DROP ROUTINE %s{}', {oid}::oid::regprocedure); END $l8db$",
            cascade(*all)
        ),
        DatabaseAction::SetTrigger {
            schema,
            table,
            name,
            enabled,
        } => format!(
            "ALTER TABLE {} {} TRIGGER {}",
            qualified(schema, table)?,
            flag(*enabled, "ENABLE", "DISABLE"),
            quote_identifier(name)?
        ),
        DatabaseAction::DropTrigger {
            schema,
            table,
            name,
        } => format!(
            "DROP TRIGGER {} ON {}",
            quote_identifier(name)?,
            qualified(schema, table)?
        ),
        DatabaseAction::CreateIndex {
            schema,
            table,
            name,
            columns,
            method,
            unique,
            concurrently,
        } => {
            if !INDEX_METHODS.contains(&method.as_str()) {
                return Err("Unbekannte Index-Methode.".into());
            }
            if columns.is_empty() || columns.len() > 32 {
                return Err("Ein Index braucht 1 bis 32 Spalten.".into());
            }
            let columns = columns
                .iter()
                .map(|column| quote_identifier(column))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            let name = if name.trim().is_empty() {
                String::new()
            } else {
                format!("{} ", quote_identifier(name.trim())?)
            };
            format!(
                "CREATE {}INDEX {}{name}ON {} USING {method} ({columns})",
                flag(*unique, "UNIQUE ", ""),
                flag(*concurrently, "CONCURRENTLY ", ""),
                qualified(schema, table)?
            )
        }
        DatabaseAction::DropIndex {
            schema,
            name,
            concurrently,
        } => format!(
            "DROP INDEX {}{}",
            flag(*concurrently, "CONCURRENTLY ", ""),
            qualified(schema, name)?
        ),
        DatabaseAction::DropEnum {
            schema,
            name,
            cascade: all,
        } => format!("DROP TYPE {}{}", qualified(schema, name)?, cascade(*all)),
        DatabaseAction::CreateEnum {
            schema,
            name,
            values,
        } => {
            if values.len() > 500 {
                return Err("Zu viele Werte.".into());
            }
            let values = values
                .iter()
                .map(|value| literal(value))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            format!("CREATE TYPE {} AS ENUM ({values})", qualified(schema, name)?)
        }
        DatabaseAction::AddEnumValue {
            schema,
            name,
            value,
        } => format!(
            "ALTER TYPE {} ADD VALUE {}",
            qualified(schema, name)?,
            literal(value)?
        ),
        DatabaseAction::RenameEnumValue {
            schema,
            name,
            from,
            to,
        } => format!(
            "ALTER TYPE {} RENAME VALUE {} TO {}",
            qualified(schema, name)?,
            literal(from)?,
            literal(to)?
        ),
        DatabaseAction::EnableExtension { name, schema } => format!(
            "CREATE EXTENSION IF NOT EXISTS {} WITH SCHEMA {} CASCADE",
            quote_identifier(name)?,
            quote_identifier(schema)?
        ),
        DatabaseAction::DisableExtension { name, cascade: all } => {
            format!("DROP EXTENSION {}{}", quote_identifier(name)?, cascade(*all))
        }
        DatabaseAction::CreateRole {
            name,
            attributes,
            password: secret,
        } => format!(
            "CREATE ROLE {} WITH {}{}",
            editable_role(name)?,
            role_options(attributes)?,
            if secret.is_empty() {
                String::new()
            } else {
                format!(" PASSWORD {}", password(secret)?)
            }
        ),
        DatabaseAction::AlterRole { name, attributes } => format!(
            "ALTER ROLE {} WITH {}",
            editable_role(name)?,
            role_options(attributes)?
        ),
        DatabaseAction::SetRolePassword {
            name,
            password: secret,
        } => format!(
            "ALTER ROLE {} WITH PASSWORD {}",
            editable_role(name)?,
            password(secret)?
        ),
        DatabaseAction::DropRole { name } => format!("DROP ROLE {}", editable_role(name)?),
        DatabaseAction::SetPublicationTable {
            publication,
            schema,
            table,
            add,
        } => format!(
            "ALTER PUBLICATION {} {} TABLE {}",
            quote_identifier(publication)?,
            flag(*add, "ADD", "DROP"),
            qualified(schema, table)?
        ),
        DatabaseAction::SetPublicationActions {
            publication,
            insert,
            update,
            delete,
            truncate,
        } => {
            let publish = [
                (*insert, "insert"),
                (*update, "update"),
                (*delete, "delete"),
                (*truncate, "truncate"),
            ]
            .iter()
            .filter(|(enabled, _)| *enabled)
            .map(|(_, name)| *name)
            .collect::<Vec<_>>()
            .join(", ");
            format!(
                "ALTER PUBLICATION {} SET (publish = '{publish}')",
                quote_identifier(publication)?
            )
        }
        DatabaseAction::ResetSequence {
            schema,
            name,
            value,
        } => format!(
            "ALTER SEQUENCE {} RESTART WITH {value}",
            qualified(schema, name)?
        ),
        DatabaseAction::SetRls {
            schema,
            table,
            mode,
        } => {
            let clause = match mode.as_str() {
                "enable" => "ENABLE ROW LEVEL SECURITY",
                "disable" => "DISABLE ROW LEVEL SECURITY",
                "force" => "FORCE ROW LEVEL SECURITY",
                "no_force" => "NO FORCE ROW LEVEL SECURITY",
                _ => return Err("Unbekannter RLS-Modus.".into()),
            };
            format!("ALTER TABLE {} {clause}", qualified(schema, table)?)
        }
        DatabaseAction::CreatePolicy {
            schema,
            table,
            policy,
        } => create_policy_sql(schema, table, policy)?,
        DatabaseAction::UpdatePolicy {
            schema,
            table,
            original,
            policy,
        } => format!(
            "DROP POLICY {} ON {}; {}",
            quote_identifier(original)?,
            qualified(schema, table)?,
            create_policy_sql(schema, table, policy)?
        ),
        DatabaseAction::DropPolicy {
            schema,
            table,
            name,
        } => format!(
            "DROP POLICY {} ON {}",
            quote_identifier(name)?,
            qualified(schema, table)?
        ),
    })
}

fn list_sql(
    kind: &str,
    schema: &str,
    parent: &str,
    search: &str,
    offset: u32,
) -> Result<(String, Vec<Value>), String> {
    if offset > MAX_OFFSET {
        return Err("Ungültiger Offset.".into());
    }
    if search.len() > 200 || parent.len() > 200 {
        return Err("Suchbegriff zu lang.".into());
    }
    let needs_schema = !matches!(
        kind,
        "schemas" | "extensions" | "roles" | "publications" | "publication_tables"
    );
    if needs_schema {
        quote_identifier(schema)?;
    }
    let search = json!(search);
    let scoped = vec![json!(schema), search.clone(), json!(parent)];
    let (query, parameters) = match kind {
        "schemas" => (
            "SELECT n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner, (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r','p')) AS table_count FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema' AND strpos(lower(n.nspname), lower($1)) > 0 ORDER BY n.nspname",
            vec![search],
        ),
        "views" => (
            "SELECT c.oid::int8::float8 AS oid, n.nspname AS schema, c.relname AS name, c.relkind = 'm' AS materialized, c.relispopulated AS populated, obj_description(c.oid, 'pg_class') AS comment FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('v','m') AND n.nspname = $1 AND strpos(lower(c.relname), lower($2)) > 0 AND $3::text IS NOT NULL ORDER BY c.relname",
            scoped,
        ),
        "functions" => (
            "SELECT p.oid::int8::float8 AS oid, n.nspname AS schema, p.proname AS name, pg_get_function_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS return_type, l.lanname AS language, p.prosecdef AS security_definer, p.prokind = 'p' AS is_procedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE p.prokind IN ('f','p') AND n.nspname = $1 AND strpos(lower(p.proname), lower($2)) > 0 AND $3::text IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') ORDER BY p.proname, p.oid",
            scoped,
        ),
        "triggers" => (
            "SELECT t.oid::int8::float8 AS oid, n.nspname AS schema, c.relname AS table_name, t.tgname AS name, t.tgenabled <> 'D' AS enabled, pg_get_triggerdef(t.oid, true) AS definition, p.oid::int8::float8 AS function_oid, fn.nspname || '.' || p.proname AS function_name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace fn ON fn.oid = p.pronamespace WHERE NOT t.tgisinternal AND n.nspname = $1 AND strpos(lower(t.tgname || ' ' || c.relname), lower($2)) > 0 AND ($3::text = '' OR c.relname = $3) ORDER BY c.relname, t.tgname",
            scoped,
        ),
        "indexes" => (
            "SELECT i.oid::int8::float8 AS oid, n.nspname AS schema, t.relname AS table_name, i.relname AS name, pg_get_indexdef(i.oid) AS definition, am.amname AS method, x.indisunique AS is_unique, x.indisprimary AS is_primary, x.indisvalid AS is_valid, EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.oid) AS is_constraint, pg_relation_size(i.oid)::float8 AS size_bytes, pg_size_pretty(pg_relation_size(i.oid)) AS size, coalesce(s.idx_scan, 0)::float8 AS scans FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = i.relnamespace JOIN pg_am am ON am.oid = i.relam LEFT JOIN pg_stat_all_indexes s ON s.indexrelid = i.oid WHERE n.nspname = $1 AND strpos(lower(i.relname || ' ' || t.relname), lower($2)) > 0 AND ($3::text = '' OR t.relname = $3) ORDER BY t.relname, i.relname",
            scoped,
        ),
        "enums" => (
            "SELECT t.oid::int8::float8 AS oid, n.nspname AS schema, t.typname AS name, coalesce((SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM (SELECT enumlabel, enumsortorder FROM pg_enum WHERE enumtypid = t.oid ORDER BY enumsortorder LIMIT 500) e), '[]'::json) AS enum_values FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typtype = 'e' AND n.nspname = $1 AND strpos(lower(t.typname), lower($2)) > 0 AND $3::text IS NOT NULL ORDER BY t.typname",
            scoped,
        ),
        "extensions" => (
            "SELECT a.name, a.default_version, e.extversion AS installed_version, en.nspname AS schema, a.comment FROM pg_available_extensions a LEFT JOIN pg_extension e ON e.extname = a.name LEFT JOIN pg_namespace en ON en.oid = e.extnamespace WHERE strpos(lower(a.name), lower($1)) > 0 AND ($2::text = '' OR ($2 = 'installed') = (e.extname IS NOT NULL)) ORDER BY e.extname IS NULL, a.name",
            vec![search, json!(parent)],
        ),
        "roles" => (
            "SELECT r.oid::int8::float8 AS oid, r.rolname AS name, r.rolsuper AS superuser, r.rolinherit AS inherit, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb, r.rolcanlogin AS login, r.rolreplication AS replication, r.rolbypassrls AS bypassrls, r.rolconnlimit AS connection_limit, r.rolvaliduntil::text AS valid_until, coalesce((SELECT json_agg(m.rolname ORDER BY m.rolname) FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.roleid WHERE am.member = r.oid), '[]'::json) AS member_of FROM pg_roles r WHERE strpos(lower(r.rolname), lower($1)) > 0 ORDER BY r.rolname LIKE 'pg\\_%', r.rolname",
            vec![search],
        ),
        "publications" => (
            "SELECT p.oid::int8::float8 AS oid, p.pubname AS name, pg_get_userbyid(p.pubowner) AS owner, p.puballtables AS all_tables, p.pubinsert AS publish_insert, p.pubupdate AS publish_update, p.pubdelete AS publish_delete, p.pubtruncate AS publish_truncate, (SELECT count(*)::int FROM pg_publication_tables pt WHERE pt.pubname = p.pubname) AS table_count FROM pg_publication p WHERE strpos(lower(p.pubname), lower($1)) > 0 ORDER BY p.pubname",
            vec![search],
        ),
        "publication_tables" => (
            "SELECT schemaname AS schema, tablename AS name FROM pg_publication_tables WHERE pubname = $1 AND strpos(lower(schemaname || '.' || tablename), lower($2)) > 0 ORDER BY schemaname, tablename",
            vec![json!(parent), search],
        ),
        "sequences" => (
            "SELECT s.schemaname AS schema, s.sequencename AS name, s.data_type::text AS data_type, s.start_value::text AS start_value, s.increment_by::text AS increment, s.max_value::text AS max_value, s.last_value::text AS last_value, s.cycle FROM pg_sequences s WHERE s.schemaname = $1 AND strpos(lower(s.sequencename), lower($2)) > 0 AND $3::text IS NOT NULL ORDER BY s.sequencename",
            scoped,
        ),
        "rls_tables" => (
            "SELECT c.oid::int8::float8 AS oid, n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count, coalesce((SELECT json_agg(DISTINCT p.cmd) FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname AND p.permissive = 'PERMISSIVE'), '[]'::json) AS commands FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname = $1 AND strpos(lower(c.relname), lower($2)) > 0 AND ($3::text = '' OR c.relname = $3) ORDER BY c.relname",
            scoped,
        ),
        "policies" => (
            "SELECT p.policyname AS name, p.permissive = 'PERMISSIVE' AS permissive, p.cmd AS command, array_to_json(p.roles) AS roles, p.qual AS using_expression, p.with_check AS check_expression FROM pg_policies p WHERE p.schemaname = $1 AND strpos(lower(p.policyname), lower($2)) > 0 AND p.tablename = $3 ORDER BY p.policyname",
            scoped,
        ),
        _ => return Err("Unbekannte Objektart.".into()),
    };
    Ok((
        format!("{query} LIMIT {} OFFSET {offset}", PAGE + 1),
        parameters,
    ))
}

#[tauri::command]
pub async fn supabase_studio_database_list(
    reference: String,
    kind: String,
    schema: String,
    parent: String,
    search: String,
    offset: u32,
) -> Result<DatabaseListPage, String> {
    let reference = validate_ref(&reference)?;
    let (query, parameters) = list_sql(&kind, &schema, &parent, search.trim(), offset)?;
    let mut items: Vec<Value> = database_query(reference, &query, &parameters).await?;
    let has_more = items.len() > PAGE;
    items.truncate(PAGE);
    if kind == "schemas" || kind == "roles" {
        for item in &mut items {
            let name = item["name"].as_str().unwrap_or_default();
            let protected = if kind == "schemas" {
                is_system_schema(name)
            } else {
                is_system_role(name)
            };
            item["protected"] = json!(protected);
        }
    }
    Ok(DatabaseListPage { items, has_more })
}

#[tauri::command]
pub async fn supabase_studio_database_definition(
    reference: String,
    kind: String,
    oid: u32,
) -> Result<String, String> {
    let reference = validate_ref(&reference)?;
    let query = match kind.as_str() {
        "view" => "SELECT pg_get_viewdef($1::oid, true) AS definition",
        "function" => "SELECT pg_get_functiondef($1::oid) AS definition",
        _ => return Err("Unbekannte Objektart.".into()),
    };
    let rows: Vec<Value> = database_query(reference, query, &[json!(oid)]).await?;
    rows.first()
        .and_then(|row| row["definition"].as_str())
        .map(str::to_string)
        .ok_or_else(|| "Objekt nicht gefunden.".into())
}

#[tauri::command]
pub async fn supabase_studio_database_action(
    reference: String,
    action: DatabaseAction,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    database_execute(reference, &action_sql(&action)?, &[]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(command: &str, using: &str, check: &str) -> PolicyInput {
        PolicyInput {
            name: "p\"1".into(),
            command: command.into(),
            permissive: true,
            roles: vec!["authenticated".into()],
            using_expression: using.into(),
            check_expression: check.into(),
        }
    }

    #[test]
    fn builds_quoted_ddl() {
        assert_eq!(
            action_sql(&DatabaseAction::CreateSchema {
                name: "a\"b".into()
            })
            .unwrap(),
            "CREATE SCHEMA \"a\"\"b\""
        );
        assert_eq!(
            action_sql(&DatabaseAction::AddEnumValue {
                schema: "public".into(),
                name: "mood".into(),
                value: "it's".into()
            })
            .unwrap(),
            "ALTER TYPE \"public\".\"mood\" ADD VALUE 'it''s'"
        );
        assert_eq!(
            action_sql(&DatabaseAction::CreateIndex {
                schema: "public".into(),
                table: "t".into(),
                name: "".into(),
                columns: vec!["a".into(), "b".into()],
                method: "btree".into(),
                unique: true,
                concurrently: true,
            })
            .unwrap(),
            "CREATE UNIQUE INDEX CONCURRENTLY ON \"public\".\"t\" USING btree (\"a\", \"b\")"
        );
        assert!(action_sql(&DatabaseAction::DropFunction {
            oid: 42,
            cascade: true
        })
        .unwrap()
        .contains("DROP ROUTINE %s CASCADE', 42::oid::regprocedure"));
        assert_eq!(
            action_sql(&DatabaseAction::SetPublicationActions {
                publication: "pub".into(),
                insert: true,
                update: false,
                delete: true,
                truncate: false,
            })
            .unwrap(),
            "ALTER PUBLICATION \"pub\" SET (publish = 'insert, delete')"
        );
        assert_eq!(
            action_sql(&DatabaseAction::DropEnum {
                schema: "public".into(),
                name: "mood".into(),
                cascade: true,
            })
            .unwrap(),
            "DROP TYPE \"public\".\"mood\" CASCADE"
        );
    }

    #[test]
    fn rejects_unsafe_input() {
        assert!(action_sql(&DatabaseAction::DropSchema {
            name: "auth".into(),
            cascade: false
        })
        .is_err());
        assert!(action_sql(&DatabaseAction::DropRole {
            name: "supabase_admin".into()
        })
        .is_err());
        assert!(action_sql(&DatabaseAction::SetRolePassword {
            name: "anon".into(),
            password: "longenough".into()
        })
        .is_err());
        assert!(action_sql(&DatabaseAction::CreateIndex {
            schema: "public".into(),
            table: "t".into(),
            name: "".into(),
            columns: vec!["a".into()],
            method: "btree; DROP".into(),
            unique: false,
            concurrently: false,
        })
        .is_err());
        assert!(action_sql(&DatabaseAction::SetRls {
            schema: "public".into(),
            table: "t".into(),
            mode: "off".into()
        })
        .is_err());
        assert!(expression("true; DROP TABLE x").is_err());
        assert!(expression("true -- x").is_err());
        assert!(literal("a\0b").is_err());
        assert!(list_sql("nope", "public", "", "", 0).is_err());
        assert!(list_sql("views", "public", "", "", MAX_OFFSET + 1).is_err());
        assert!(list_sql("views", "", "", "", 0).is_err());
    }

    #[test]
    fn builds_policies() {
        let create = action_sql(&DatabaseAction::CreatePolicy {
            schema: "public".into(),
            table: "notes".into(),
            policy: policy("all", "auth.uid() = user_id", "auth.uid() = user_id"),
        })
        .unwrap();
        assert_eq!(
            create,
            "CREATE POLICY \"p\"\"1\" ON \"public\".\"notes\" AS PERMISSIVE FOR ALL TO \"authenticated\" USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)"
        );
        assert!(policy_clauses(&policy("INSERT", "true", "")).is_err());
        assert!(policy_clauses(&policy("SELECT", "", "true")).is_err());
        assert!(policy_clauses(&policy("SELECT", "", "")).is_err());
        assert_eq!(policy_roles(&[]).unwrap(), "public");
        let recreate = action_sql(&DatabaseAction::UpdatePolicy {
            schema: "public".into(),
            table: "notes".into(),
            original: "old".into(),
            policy: policy("ALL", "true", ""),
        })
        .unwrap();
        assert!(recreate.starts_with("DROP POLICY \"old\""), "{recreate}");
        assert!(recreate.contains("; CREATE POLICY"));
    }

    #[test]
    fn list_queries_are_bounded() {
        for kind in [
            "schemas",
            "views",
            "functions",
            "triggers",
            "indexes",
            "enums",
            "extensions",
            "roles",
            "publications",
            "publication_tables",
            "sequences",
            "rls_tables",
            "policies",
        ] {
            let (query, parameters) = list_sql(kind, "public", "", "x", 100).unwrap();
            assert!(query.ends_with("LIMIT 101 OFFSET 100"), "{kind}");
            let highest = (1..=3)
                .rev()
                .find(|index| query.contains(&format!("${index}")))
                .unwrap_or(0);
            assert_eq!(highest, parameters.len(), "{kind}");
        }
    }

    #[tokio::test]
    #[ignore]
    async fn supabase_studio_database_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let reference = crate::supabase::supabase_connect_self_hosted(url, key, "Lab".into())
            .await
            .unwrap()
            .reference;
        let run = |action: Value| {
            let reference = reference.clone();
            async move {
                supabase_studio_database_action(reference, serde_json::from_value(action).unwrap())
                    .await
            }
        };
        let list = |kind: &str, schema: &str, parent: &str, search: &str| {
            supabase_studio_database_list(
                reference.clone(),
                kind.into(),
                schema.into(),
                parent.into(),
                search.into(),
                0,
            )
        };
        let _ = run(json!({"action": "drop_schema", "name": "l8db_db", "cascade": true})).await;
        let _ = run(json!({"action": "drop_role", "name": "l8db_db_role"})).await;
        let _ = crate::supabase::database_execute(
            &reference,
            "DROP PUBLICATION IF EXISTS l8db_db_pub",
            &[],
        )
        .await;

        run(json!({"action": "create_schema", "name": "l8db_db"}))
            .await
            .unwrap();
        crate::supabase::database_execute(
            &reference,
            "CREATE TABLE l8db_db.notes (id bigserial PRIMARY KEY, user_id uuid, body text); INSERT INTO l8db_db.notes (body) SELECT 'n' || g FROM generate_series(1, 50) g; CREATE MATERIALIZED VIEW l8db_db.note_count AS SELECT count(*) FROM l8db_db.notes; CREATE FUNCTION l8db_db.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER touch BEFORE UPDATE ON l8db_db.notes FOR EACH ROW EXECUTE FUNCTION l8db_db.touch(); CREATE PUBLICATION l8db_db_pub",
            &[],
        )
        .await
        .unwrap();

        let schemas = list("schemas", "", "", "l8db").await.unwrap();
        assert_eq!(schemas.items[0]["name"], "l8db_db");
        assert_eq!(schemas.items[0]["protected"], false);
        let auth = list("schemas", "", "", "auth").await.unwrap();
        assert!(auth.items.iter().any(|item| item["protected"] == true));

        let views = list("views", "l8db_db", "", "").await.unwrap();
        assert_eq!(views.items[0]["materialized"], true);
        let view_oid = views.items[0]["oid"].as_f64().unwrap() as u32;
        assert!(
            supabase_studio_database_definition(reference.clone(), "view".into(), view_oid)
                .await
                .unwrap()
                .contains("count")
        );
        run(json!({"action": "refresh_view", "schema": "l8db_db", "name": "note_count"}))
            .await
            .unwrap();

        let functions = list("functions", "l8db_db", "", "touch").await.unwrap();
        assert_eq!(functions.items[0]["return_type"], "trigger");
        let function_oid = functions.items[0]["oid"].as_f64().unwrap() as u32;
        assert!(supabase_studio_database_definition(
            reference.clone(),
            "function".into(),
            function_oid
        )
        .await
        .unwrap()
        .contains("plpgsql"));

        let triggers = list("triggers", "l8db_db", "notes", "").await.unwrap();
        assert_eq!(triggers.items[0]["enabled"], true);
        run(json!({"action": "set_trigger", "schema": "l8db_db", "table": "notes", "name": "touch", "enabled": false})).await.unwrap();
        assert_eq!(
            list("triggers", "l8db_db", "notes", "")
                .await
                .unwrap()
                .items[0]["enabled"],
            false
        );
        run(json!({"action": "drop_trigger", "schema": "l8db_db", "table": "notes", "name": "touch"})).await.unwrap();

        run(json!({"action": "create_index", "schema": "l8db_db", "table": "notes", "name": "notes_body_idx", "columns": ["body"], "method": "btree", "unique": false, "concurrently": true})).await.unwrap();
        let indexes = list("indexes", "l8db_db", "notes", "").await.unwrap();
        assert_eq!(indexes.items.len(), 2);
        run(json!({"action": "drop_index", "schema": "l8db_db", "name": "notes_body_idx", "concurrently": false})).await.unwrap();

        run(json!({"action": "create_enum", "schema": "l8db_db", "name": "mood", "values": ["ok", "sad"]})).await.unwrap();
        run(json!({"action": "add_enum_value", "schema": "l8db_db", "name": "mood", "value": "happy"})).await.unwrap();
        run(json!({"action": "rename_enum_value", "schema": "l8db_db", "name": "mood", "from": "sad", "to": "blue"})).await.unwrap();
        assert_eq!(
            list("enums", "l8db_db", "", "").await.unwrap().items[0]["enum_values"],
            json!(["ok", "blue", "happy"])
        );

        let extensions = list("extensions", "", "available", "hstore").await.unwrap();
        assert!(extensions.items.iter().any(|item| item["name"] == "hstore"));
        run(json!({"action": "enable_extension", "name": "hstore", "schema": "l8db_db"}))
            .await
            .unwrap();
        assert_eq!(
            list("extensions", "", "installed", "hstore")
                .await
                .unwrap()
                .items[0]["schema"],
            "l8db_db"
        );
        run(json!({"action": "disable_extension", "name": "hstore", "cascade": false}))
            .await
            .unwrap();

        let attributes = json!({"login": true, "inherit": true, "createdb": false, "createrole": false, "bypassrls": false, "connection_limit": 5});
        run(json!({"action": "create_role", "name": "l8db_db_role", "attributes": attributes, "password": "secret-password"})).await.unwrap();
        run(json!({"action": "alter_role", "name": "l8db_db_role", "attributes": {"login": false, "inherit": false, "createdb": true, "createrole": false, "bypassrls": true, "connection_limit": -1}})).await.unwrap();
        run(json!({"action": "set_role_password", "name": "l8db_db_role", "password": "another-password"})).await.unwrap();
        let role = list("roles", "", "", "l8db_db_role").await.unwrap();
        assert_eq!(role.items[0]["login"], false);
        assert_eq!(role.items[0]["bypassrls"], true);
        assert_eq!(role.items[0]["protected"], false);
        assert!(run(json!({"action": "drop_role", "name": "authenticated"}))
            .await
            .is_err());
        run(json!({"action": "drop_role", "name": "l8db_db_role"}))
            .await
            .unwrap();

        run(json!({"action": "set_publication_table", "publication": "l8db_db_pub", "schema": "l8db_db", "table": "notes", "add": true})).await.unwrap();
        run(json!({"action": "set_publication_actions", "publication": "l8db_db_pub", "insert": true, "update": false, "delete": false, "truncate": false})).await.unwrap();
        let publication = list("publications", "", "", "l8db_db_pub").await.unwrap();
        assert_eq!(publication.items[0]["table_count"], 1);
        assert_eq!(publication.items[0]["publish_update"], false);
        assert_eq!(
            list("publication_tables", "", "l8db_db_pub", "")
                .await
                .unwrap()
                .items[0]["name"],
            "notes"
        );
        run(json!({"action": "set_publication_table", "publication": "l8db_db_pub", "schema": "l8db_db", "table": "notes", "add": false})).await.unwrap();

        run(json!({"action": "reset_sequence", "schema": "l8db_db", "name": "notes_id_seq", "value": 7})).await.unwrap();
        assert_eq!(
            list("sequences", "l8db_db", "", "").await.unwrap().items[0]["start_value"],
            "1"
        );

        run(json!({"action": "set_rls", "schema": "l8db_db", "table": "notes", "mode": "enable"}))
            .await
            .unwrap();
        run(json!({"action": "set_rls", "schema": "l8db_db", "table": "notes", "mode": "force"}))
            .await
            .unwrap();
        let policy = json!({"name": "own", "command": "ALL", "permissive": true, "roles": ["authenticated"], "using_expression": "(select auth.uid()) = user_id", "check_expression": "(select auth.uid()) = user_id"});
        run(json!({"action": "create_policy", "schema": "l8db_db", "table": "notes", "policy": policy})).await.unwrap();
        run(json!({"action": "update_policy", "schema": "l8db_db", "table": "notes", "original": "own", "policy": {"name": "own_renamed", "command": "ALL", "permissive": true, "roles": ["authenticated", "anon"], "using_expression": "true", "check_expression": ""}})).await.unwrap();
        let cleared = list("policies", "l8db_db", "notes", "").await.unwrap();
        assert_eq!(cleared.items[0]["name"], "own_renamed");
        assert_eq!(cleared.items[0]["check_expression"], Value::Null);
        run(json!({"action": "update_policy", "schema": "l8db_db", "table": "notes", "original": "own_renamed", "policy": {"name": "readers", "command": "SELECT", "permissive": false, "roles": [], "using_expression": "true", "check_expression": ""}})).await.unwrap();
        assert!(run(json!({"action": "update_policy", "schema": "l8db_db", "table": "notes", "original": "readers", "policy": {"name": "broken", "command": "UPDATE", "permissive": true, "roles": [], "using_expression": "no_such_column = 1", "check_expression": ""}})).await.is_err());
        let tables = list("rls_tables", "l8db_db", "notes", "").await.unwrap();
        assert_eq!(tables.items[0]["rls_enabled"], true);
        assert_eq!(tables.items[0]["rls_forced"], true);
        assert_eq!(tables.items[0]["policy_count"], 1);
        assert_eq!(tables.items[0]["commands"], json!([]));
        let policies = list("policies", "l8db_db", "notes", "").await.unwrap();
        assert_eq!(policies.items[0]["name"], "readers");
        assert_eq!(policies.items[0]["command"], "SELECT");
        assert_eq!(policies.items[0]["permissive"], false);
        assert_eq!(policies.items[0]["roles"], json!(["public"]));
        run(json!({"action": "drop_policy", "schema": "l8db_db", "table": "notes", "name": "readers"})).await.unwrap();
        run(json!({"action": "set_rls", "schema": "l8db_db", "table": "notes", "mode": "disable"}))
            .await
            .unwrap();
        list("policies", "storage", "objects", "").await.unwrap();

        for kind in [
            "schemas",
            "views",
            "functions",
            "triggers",
            "indexes",
            "enums",
            "extensions",
            "roles",
            "publications",
            "sequences",
            "rls_tables",
        ] {
            let page = list(kind, "public", "", "").await.unwrap();
            assert!(page.items.len() <= PAGE);
            latency(&format!("database {kind}"), 500, || async {
                list(kind, "public", "", "").await.unwrap();
            })
            .await;
        }
        latency("database storage policies", 500, || async {
            list("policies", "storage", "objects", "").await.unwrap();
        })
        .await;

        run(json!({"action": "drop_view", "schema": "l8db_db", "name": "note_count", "materialized": true, "cascade": false})).await.unwrap();
        run(json!({"action": "drop_function", "oid": function_oid, "cascade": false}))
            .await
            .unwrap();
        crate::supabase::database_execute(&reference, "DROP PUBLICATION l8db_db_pub", &[])
            .await
            .unwrap();
        run(json!({"action": "drop_schema", "name": "l8db_db", "cascade": true}))
            .await
            .unwrap();
        assert!(list("schemas", "", "", "l8db_db")
            .await
            .unwrap()
            .items
            .is_empty());
    }
}
