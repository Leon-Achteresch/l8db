use crate::db::{self, create_adapter_from_string, provider::DatabaseKind, DatabaseAdapter};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
pub fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
pub fn hash(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn table(schema: &str, suffix: &str) -> String {
    format!("{}.\"L8DB_VERSIONING_{suffix}\"", quote(schema))
}

pub fn body_sql(connection: &Connection, body: &str) -> String {
    if connection.kind != DatabaseKind::Oracle {
        return literal(body);
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < body.len() {
        let mut end = (start + 1000).min(body.len());
        while !body.is_char_boundary(end) {
            end -= 1;
        }
        chunks.push(format!("TO_CLOB({})", literal(&body[start..end])));
        start = end;
    }
    if chunks.is_empty() {
        "TO_CLOB('')".into()
    } else {
        chunks.join(" || ")
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub track: String,
    pub pinned_release: Option<String>,
    pub paused: bool,
    pub production: bool,
    #[serde(default)]
    pub require_approval: bool,
    #[serde(default)]
    pub operators: Vec<String>,
    #[serde(default)]
    pub administrators: Vec<String>,
    #[serde(default)]
    pub reviewers: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRecord {
    pub revision: i64,
    pub policy: Policy,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub kind: DatabaseKind,
    pub connection_string: String,
    pub database: Option<String>,
    pub schema: String,
    pub project_id: String,
    #[serde(default)]
    pub read_only: bool,
}

impl Connection {
    pub fn adapter(&self, pool: db::pool::PoolState) -> Result<Box<dyn DatabaseAdapter>, String> {
        if !matches!(self.kind, DatabaseKind::Postgres | DatabaseKind::Oracle)
            || self.schema.is_empty()
            || self.project_id.is_empty()
        {
            return Err("Ungültiges Versionierungsziel".into());
        }
        create_adapter_from_string(
            self.kind,
            &self.connection_string,
            self.database.as_deref(),
            pool,
        )
    }
    pub fn writable(&self) -> Result<(), String> {
        if self.read_only {
            Err("Die Zielverbindung ist schreibgeschützt".into())
        } else {
            Ok(())
        }
    }
    pub fn actor_sql(&self) -> &'static str {
        if self.kind == DatabaseKind::Oracle {
            "SYS_CONTEXT('USERENV','SESSION_USER')"
        } else {
            "session_user"
        }
    }
    pub fn now_sql(&self) -> &'static str {
        if self.kind == DatabaseKind::Oracle {
            "SYS_EXTRACT_UTC(SYSTIMESTAMP)"
        } else {
            "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')"
        }
    }
}

pub async fn actor(
    adapter: &dyn DatabaseAdapter,
    connection: &Connection,
) -> Result<String, String> {
    let suffix = if connection.kind == DatabaseKind::Oracle {
        " FROM dual"
    } else {
        ""
    };
    let rows = adapter
        .execute_query(&format!(
            "SELECT {} AS \"ACTOR\"{suffix}",
            connection.actor_sql()
        ))
        .await?;
    rows.rows
        .first()
        .and_then(|row| row["ACTOR"].as_str())
        .map(str::to_owned)
        .ok_or("Datenbankbenutzer nicht lesbar".into())
}

pub async fn initialize(
    adapter: &dyn DatabaseAdapter,
    connection: &Connection,
    policy: &Policy,
) -> Result<(), String> {
    connection.writable()?;
    if policy.track.is_empty() {
        return Err("Release-Linie fehlt".into());
    }
    let existing = adapter
        .execute_query(&format!(
            "SELECT \"PROJECT_ID\" FROM {} WHERE \"PROJECT_ID\"={}",
            table(&connection.schema, "POLICY"),
            literal(&connection.project_id)
        ))
        .await;
    match existing {
        Ok(result) if !result.rows.is_empty() => return Ok(()),
        Ok(_) => {}
        Err(error)
            if error.contains("42P01")
                || error.contains("does not exist")
                || error.contains("existiert nicht")
                || error.contains("ORA-00942") => {}
        Err(error) => return Err(error),
    }
    let mut policy = policy.clone();
    policy.administrators = vec![actor(adapter, connection).await?];
    let v = if connection.kind == DatabaseKind::Oracle {
        "VARCHAR2"
    } else {
        "VARCHAR"
    };
    let large = if connection.kind == DatabaseKind::Oracle {
        "CLOB"
    } else {
        "TEXT"
    };
    let definitions = [
        ("LOCKS", format!("\"LOCK_ID\" {v}(100) PRIMARY KEY")),
        ("POLICY", format!("\"PROJECT_ID\" {v}(100) PRIMARY KEY, \"REVISION\" INTEGER NOT NULL, \"BODY\" {large} NOT NULL")),
        ("JOURNAL", format!("\"ENTRY_ID\" {v}(100) PRIMARY KEY, \"PROJECT_ID\" {v}(100) NOT NULL, \"RUN_ID\" {v}(100) NOT NULL, \"CREATED_AT\" TIMESTAMP NOT NULL, \"ACTOR\" {v}(256) NOT NULL, \"EVENT\" {v}(100) NOT NULL, \"BODY\" {large} NOT NULL")),
        ("APPROVALS", format!("\"PROJECT_ID\" {v}(100) NOT NULL, \"ARTIFACT\" {v}(64) NOT NULL, \"ACTOR\" {v}(256) NOT NULL, \"CREATED_AT\" TIMESTAMP NOT NULL, PRIMARY KEY (\"PROJECT_ID\", \"ARTIFACT\", \"ACTOR\", \"CREATED_AT\")")),
    ];
    for (name, columns) in definitions {
        if let Err(error) = adapter
            .execute_query(&format!(
                "CREATE TABLE {} ({columns})",
                table(&connection.schema, name)
            ))
            .await
        {
            if !error.contains("already exists")
                && !error.contains("ORA-00955")
                && !error.contains("42P07")
                && !error.contains("bereits")
            {
                return Err(error);
            }
        }
    }
    if let Err(error) = adapter
        .execute_query(&format!(
            "INSERT INTO {} (\"LOCK_ID\") VALUES ('schema')",
            table(&connection.schema, "LOCKS")
        ))
        .await
    {
        if !error.contains("duplicate")
            && !error.contains("ORA-00001")
            && !error.contains("23505")
            && !error.contains("doppelt")
        {
            return Err(error);
        }
    }
    let rows = adapter
        .execute_query(&format!(
            "SELECT \"PROJECT_ID\" FROM {} WHERE \"PROJECT_ID\" = {}",
            table(&connection.schema, "POLICY"),
            literal(&connection.project_id)
        ))
        .await?;
    if rows.rows.is_empty() {
        adapter
            .execute_query(&format!(
                "INSERT INTO {} (\"PROJECT_ID\", \"REVISION\", \"BODY\") VALUES ({}, 1, {})",
                table(&connection.schema, "POLICY"),
                literal(&connection.project_id),
                body_sql(
                    connection,
                    &serde_json::to_string(&policy).map_err(|e| e.to_string())?
                )
            ))
            .await?;
        append(
            adapter,
            connection,
            "policy",
            "policy_initialized",
            &json!(policy),
        )
        .await?;
    }
    Ok(())
}

pub async fn policy(
    adapter: &dyn DatabaseAdapter,
    connection: &Connection,
) -> Result<PolicyRecord, String> {
    let result = adapter
        .execute_query(&format!(
            "SELECT \"REVISION\", \"BODY\" FROM {} WHERE \"PROJECT_ID\" = {}",
            table(&connection.schema, "POLICY"),
            literal(&connection.project_id)
        ))
        .await?;
    let row = result
        .rows
        .first()
        .ok_or("Gemeinsame Kundenregeln fehlen. Ausgangsstand neu abgleichen.")?;
    let revision = row["REVISION"]
        .as_i64()
        .or_else(|| row["REVISION"].as_str().and_then(|s| s.parse().ok()))
        .ok_or("Ungültige Regelrevision")?;
    let policy = serde_json::from_str(row["BODY"].as_str().ok_or("Regeln sind nicht lesbar")?)
        .map_err(|e| format!("Ungültige Kundenregeln: {e}"))?;
    Ok(PolicyRecord { revision, policy })
}

pub async fn append(
    adapter: &dyn DatabaseAdapter,
    connection: &Connection,
    run: &str,
    event: &str,
    body: &Value,
) -> Result<(), String> {
    adapter
        .execute_query(&journal_sql(connection, run, event, body)?)
        .await?;
    Ok(())
}

fn journal_sql(
    connection: &Connection,
    run: &str,
    event: &str,
    body: &Value,
) -> Result<String, String> {
    let id = format!(
        "{}-{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        super::SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let content = serde_json::to_string(body).map_err(|e| e.to_string())?;
    if content.len() > 16 * 1024 * 1024 || run.len() > 100 || event.len() > 100 {
        return Err("Journal-Eintrag zu groß".into());
    }
    Ok(format!("INSERT INTO {} (\"ENTRY_ID\", \"PROJECT_ID\", \"RUN_ID\", \"CREATED_AT\", \"ACTOR\", \"EVENT\", \"BODY\") VALUES ({}, {}, {}, {}, {}, {}, {})",table(&connection.schema,"JOURNAL"),literal(&id),literal(&connection.project_id),literal(run),connection.now_sql(),connection.actor_sql(),literal(event),body_sql(connection,&content)))
}

pub async fn lock(
    connection: &Connection,
    schemas: &[String],
    transactions: &db::transaction::TransactionState,
    pool: &db::pool::PoolState,
) -> Result<String, String> {
    connection.writable()?;
    let tx = transactions
        .begin(
            connection.kind,
            &connection.connection_string,
            connection.database.as_deref(),
            pool,
        )
        .await?;
    let mut scopes = schemas.to_vec();
    scopes.push(connection.schema.clone());
    scopes.sort();
    scopes.dedup();
    for schema in scopes {
        if let Err(error) = transactions
            .execute(
                &tx,
                &format!(
                    "SELECT \"LOCK_ID\" FROM {} WHERE \"LOCK_ID\" = 'schema' FOR UPDATE NOWAIT",
                    table(&schema, "LOCKS")
                ),
            )
            .await
            .and_then(|r| {
                if r.rows.len() == 1 {
                    Ok(r)
                } else {
                    Err("Schemasperre fehlt".into())
                }
            })
        {
            transactions
                .rollback(&tx)
                .await
                .map_err(|e| format!("{error}; Sperrsitzung nicht geschlossen: {e}"))?;
            return Err(format!("Schema wird bereits aktualisiert oder Sperre fehlt. Kein Abgleich während laufender Ausführung: {error}"));
        }
    }
    Ok(tx)
}

pub async fn execution_lock(
    connection: &Connection,
    tx: &str,
    transactions: &db::transaction::TransactionState,
) -> Result<(), String> {
    let scope = format!("l8db-versioning:{}", connection.schema);
    let id = u32::from_str_radix(&hash(&scope)[..7], 16).map_err(|e| e.to_string())?;
    let sql = if connection.kind == DatabaseKind::Oracle {
        format!("DECLARE result INTEGER; BEGIN result := SYS.DBMS_LOCK.REQUEST(id => {id}, lockmode => 6, timeout => 0, release_on_commit => FALSE); IF result NOT IN (0,4) THEN RAISE_APPLICATION_ERROR(-20001, 'Versioning executor still active'); END IF; END;")
    } else {
        format!("SELECT pg_catalog.pg_try_advisory_xact_lock({id}::bigint) AS \"LOCKED\"")
    };
    let result = transactions.execute(tx, &sql).await.map_err(|e| {
        format!("Ausführungssperre nicht verfügbar. Oracle benötigt EXECUTE auf SYS.DBMS_LOCK: {e}")
    })?;
    if connection.kind == DatabaseKind::Postgres
        && !result
            .rows
            .first()
            .is_some_and(|r| r["LOCKED"] == true || r["LOCKED"] == "t" || r["LOCKED"] == "true")
    {
        return Err("Eine Ausführung ist noch aktiv. Abgleich ist gesperrt.".into());
    }
    Ok(())
}

pub async fn check_lock(
    connection: &Connection,
    tx: &str,
    transactions: &db::transaction::TransactionState,
) -> Result<(), String> {
    let result = transactions
        .execute(
            tx,
            &format!(
                "SELECT \"LOCK_ID\" FROM {} WHERE \"LOCK_ID\" = 'schema' FOR UPDATE NOWAIT",
                table(&connection.schema, "LOCKS")
            ),
        )
        .await?;
    if result.rows.len() != 1 {
        return Err("Schemasperre verloren".into());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub connection: Connection,
    pub action: String,
    pub policy: Option<Policy>,
    pub revision: Option<i64>,
    pub artifact: Option<String>,
    pub run_id: Option<String>,
    pub event: Option<String>,
    pub body: Option<Value>,
    #[serde(default)]
    pub schemas: Vec<String>,
    pub tx_id: Option<String>,
}

pub async fn handle(
    request: Request,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
) -> Result<Value, String> {
    let c = request.connection;
    let adapter = c.adapter(pool.clone())?;
    match request.action.as_str() {
        "initialize" => {
            initialize(
                adapter.as_ref(),
                &c,
                request.policy.as_ref().ok_or("Regeln fehlen")?,
            )
            .await?;
            Ok(json!(policy(adapter.as_ref(), &c).await?))
        }
        "policy" => Ok(json!(policy(adapter.as_ref(), &c).await?)),
        "lock" => Ok(json!(
            lock(&c, &request.schemas, &transactions, &pool).await?
        )),
        "recovery-lock" | "baseline-lock" => {
            let current = policy(adapter.as_ref(), &c).await?;
            let user = actor(adapter.as_ref(), &c).await?;
            let administrator = current.policy.administrators.contains(&user);
            let operator =
                current.policy.operators.is_empty() || current.policy.operators.contains(&user);
            if !administrator && (request.action == "recovery-lock" || !operator) {
                return Err("Nur ein Regeladministrator darf den Ausgangsstand abgleichen".into());
            }
            let tx = lock(&c, &[], &transactions, &pool).await?;
            let mut schemas = request.schemas;
            schemas.push(c.schema.clone());
            schemas.sort();
            schemas.dedup();
            for schema in schemas {
                let mut scoped = c.clone();
                scoped.schema = schema;
                if let Err(error) = execution_lock(&scoped, &tx, &transactions).await {
                    transactions.rollback(&tx).await?;
                    return Err(error);
                }
            }
            Ok(json!(tx))
        }
        "execution-lock" => {
            execution_lock(
                &c,
                request.tx_id.as_deref().ok_or("Ausführungssitzung fehlt")?,
                &transactions,
            )
            .await?;
            Ok(Value::Null)
        }
        "check-lock" => {
            check_lock(
                &c,
                request.tx_id.as_deref().ok_or("Sperrsitzung fehlt")?,
                &transactions,
            )
            .await?;
            Ok(Value::Null)
        }
        "save-policy" => {
            c.writable()?;
            let next = request.policy.ok_or("Regeln fehlen")?;
            let current = policy(adapter.as_ref(), &c).await?;
            if !current
                .policy
                .administrators
                .contains(&actor(adapter.as_ref(), &c).await?)
            {
                return Err("Nur ein Regeladministrator darf Kundenregeln ändern".into());
            }
            if next.administrators.is_empty() {
                return Err("Mindestens ein Regeladministrator ist erforderlich".into());
            }
            if next.track.is_empty()
                || next
                    .operators
                    .iter()
                    .chain(&next.reviewers)
                    .chain(&next.administrators)
                    .any(|s| s.trim().is_empty())
                || (next.require_approval && next.reviewers.is_empty())
            {
                return Err("Ungültige Kundenregeln".into());
            }
            let tx = lock(&c, &[], &transactions, &pool).await?;
            let outcome = async {
                let current = policy(adapter.as_ref(), &c).await?;
                if !current.policy.administrators.contains(&actor(adapter.as_ref(), &c).await?) { return Err("Regeladministrator wurde inzwischen geändert".into()); }
                let body = serde_json::to_string(&next).map_err(|e|e.to_string())?;
                let result = transactions.execute(&tx,&format!("UPDATE {} SET \"REVISION\" = \"REVISION\" + 1, \"BODY\" = {} WHERE \"PROJECT_ID\" = {} AND \"REVISION\" = {}",table(&c.schema,"POLICY"),body_sql(&c, &body),literal(&c.project_id),request.revision.ok_or("Regelrevision fehlt")?)).await?;
                if result.rows_affected != Some(1) { return Err("Kundenregeln wurden inzwischen geändert".into()); }
                transactions.execute(&tx,&journal_sql(&c,"policy","policy_changed",&json!(next))?).await?;
                transactions.commit(&tx).await
            }.await;
            if let Err(error) = outcome {
                transactions.rollback(&tx).await?;
                return Err(error);
            }
            Ok(json!(policy(adapter.as_ref(), &c).await?))
        }

        "request-review" => {
            c.writable()?;
            let content = request
                .body
                .as_ref()
                .and_then(Value::as_str)
                .ok_or("Freigabeartefakt fehlt")?;
            if content.len() > 8 * 1024 * 1024 {
                return Err("Freigabeartefakt zu groß".into());
            }
            let parsed: Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
            let current = policy(adapter.as_ref(), &c).await?;
            if parsed["policyRevision"].as_i64() != Some(current.revision) {
                return Err("Kundenregeln wurden inzwischen geändert".into());
            }
            let artifact = hash(content);
            append(
                adapter.as_ref(),
                &c,
                &artifact,
                "review_requested",
                &json!(content),
            )
            .await?;
            Ok(json!(artifact))
        }
        "authorize" => {
            c.writable()?;
            let current = policy(adapter.as_ref(), &c).await?;
            let user = actor(adapter.as_ref(), &c).await?;
            if current.policy.paused {
                return Err("Updates für diese Datenbank sind pausiert".into());
            }
            if request.revision != Some(current.revision) {
                return Err("Kundenregeln wurden inzwischen geändert. Neu planen.".into());
            }
            if !current.policy.operators.is_empty() && !current.policy.operators.contains(&user) {
                return Err("Datenbankbenutzer ist nicht für Rollouts freigegeben".into());
            }
            if current.policy.require_approval {
                let artifact = request
                    .artifact
                    .as_deref()
                    .ok_or("Freigabeartefakt fehlt")?;
                let age = if c.kind == DatabaseKind::Oracle {
                    "NUMTODSINTERVAL(15, 'MINUTE')"
                } else {
                    "INTERVAL '15 minutes'"
                };
                let result = adapter.execute_query(&format!("SELECT \"ACTOR\" FROM {} WHERE \"PROJECT_ID\" = {} AND \"ARTIFACT\" = {} AND \"CREATED_AT\" >= {} - {age}", table(&c.schema,"APPROVALS"), literal(&c.project_id),literal(artifact),c.now_sql())).await?;
                if !result.rows.iter().any(|r| {
                    r["ACTOR"].as_str().is_some_and(|a| {
                        a != user
                            && current
                                .policy
                                .reviewers
                                .iter()
                                .any(|reviewer| reviewer == a)
                    })
                }) {
                    return Err("Freigabe durch einen zweiten Datenbankbenutzer fehlt oder ist älter als 15 Minuten".into());
                }
            }
            Ok(json!(current))
        }
        "journal" => {
            let result = adapter.execute_query(&format!("SELECT \"ENTRY_ID\", \"RUN_ID\", \"CREATED_AT\", \"ACTOR\", \"EVENT\", \"BODY\" FROM {} WHERE \"PROJECT_ID\" = {} ORDER BY \"CREATED_AT\" DESC, \"ENTRY_ID\" DESC FETCH FIRST 500 ROWS ONLY",table(&c.schema,"JOURNAL"),literal(&c.project_id))).await?;
            Ok(json!(result.rows))
        }
        "append" => {
            c.writable()?;
            append(
                adapter.as_ref(),
                &c,
                request.run_id.as_deref().ok_or("Lauf fehlt")?,
                request.event.as_deref().ok_or("Ereignis fehlt")?,
                request.body.as_ref().ok_or("Inhalt fehlt")?,
            )
            .await?;
            Ok(Value::Null)
        }
        "approve" => {
            c.writable()?;
            let current = policy(adapter.as_ref(), &c).await?;
            let reviewer = actor(adapter.as_ref(), &c).await?;
            if !current.policy.reviewers.contains(&reviewer) {
                return Err("Datenbankbenutzer ist kein Freigeber".into());
            }
            let artifact = request.artifact.ok_or("Artefakt fehlt")?;
            if artifact.len() != 64 || !artifact.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Ungültiges Artefakt".into());
            }
            let age = if c.kind == DatabaseKind::Oracle {
                "NUMTODSINTERVAL(15, 'MINUTE')"
            } else {
                "INTERVAL '15 minutes'"
            };
            let reviews = adapter.execute_query(&format!("SELECT \"BODY\", \"ACTOR\" FROM {} WHERE \"PROJECT_ID\" = {} AND \"RUN_ID\" = {} AND \"EVENT\" = 'review_requested' AND \"CREATED_AT\" >= {} - {age} ORDER BY \"CREATED_AT\" DESC", table(&c.schema,"JOURNAL"),literal(&c.project_id),literal(&artifact),c.now_sql())).await?;
            let row = reviews
                .rows
                .first()
                .ok_or("Aktuelle Freigabeanfrage fehlt")?;
            if row["ACTOR"].as_str() == Some(&reviewer) {
                return Err("Eigene Rollouts dürfen nicht selbst freigegeben werden".into());
            }
            let artifact_body: Value =
                serde_json::from_str(row["BODY"].as_str().ok_or("Artefakt nicht lesbar")?)
                    .map_err(|e| e.to_string())?;
            let artifact_text = artifact_body.as_str().ok_or("Ungültiges Artefakt")?;
            let content: Value = serde_json::from_str(artifact_text).map_err(|e| e.to_string())?;
            if hash(artifact_text) != artifact
                || content["policyRevision"].as_i64() != Some(current.revision)
            {
                return Err("Freigabeanfrage ist veraltet".into());
            }
            adapter.execute_query(&format!("INSERT INTO {} (\"PROJECT_ID\", \"ARTIFACT\", \"ACTOR\", \"CREATED_AT\") VALUES ({}, {}, {}, {})", table(&c.schema,"APPROVALS"),literal(&c.project_id),literal(&artifact),c.actor_sql(),c.now_sql())).await?;
            append(
                adapter.as_ref(),
                &c,
                &artifact,
                "approved",
                &json!({"artifact":artifact}),
            )
            .await?;
            Ok(Value::Null)
        }
        _ => Err("Unbekannte Steuerungsoperation".into()),
    }
}

#[tauri::command]
pub async fn versioning_control(
    request: Request,
    pool: tauri::State<'_, db::pool::PoolState>,
    transactions: tauri::State<'_, db::transaction::TransactionState>,
) -> Result<Value, String> {
    handle(request, pool.inner().clone(), transactions.inner().clone()).await
}
