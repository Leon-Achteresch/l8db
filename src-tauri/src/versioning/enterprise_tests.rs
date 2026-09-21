use super::{
    control::{self, Connection, Policy, Request},
    snapshot,
};
use crate::db::{self, provider::DatabaseKind};
use serde_json::{json, Value};

fn request(connection: &Connection, action: &str) -> Request {
    Request {
        connection: connection.clone(),
        action: action.into(),
        policy: None,
        revision: None,
        artifact: None,
        run_id: None,
        event: None,
        body: None,
        schemas: vec![],
        tx_id: None,
    }
}
#[test]
fn metadata_normalization_preserves_program_bodies_and_unicode() {
    let sql = "TABLE source.invoice\nsource.id 'source.literal' q'[source.literal]' -- source.comment\n/* source.comment /* nested */ */ \"source\".invoice $$ source.body $$";
    assert_eq!(snapshot::requalify(sql,"source","target"),"TABLE \"target\".invoice\n\"target\".id 'source.literal' q'[source.literal]' -- source.comment\n/* source.comment /* nested */ */ \"target\".invoice $$ source.body $$");
    assert_eq!(
        snapshot::requalify("SELECT 'Grüße 🌍', source.id\r\n", "source", "source"),
        "SELECT 'Grüße 🌍', \"source\".id"
    );
    assert_eq!(
        control::hash("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
#[test]
fn oracle_journal_chunks_do_not_split_unicode_or_sql_literals() {
    let c = Connection {
        kind: DatabaseKind::Oracle,
        connection_string: String::new(),
        database: None,
        schema: "X".into(),
        project_id: "x".into(),
        read_only: false,
    };
    let data = "🦀'".repeat(1000);
    let sql = control::body_sql(&c, &data);
    assert!(sql.starts_with("TO_CLOB('"));
    assert!(sql.contains(" || "));
    assert!(!sql.contains("�"));
    assert_eq!(sql.matches("🦀").count(), 1000);
    assert_eq!(sql.matches("''").count(), 1000);
}

#[tokio::test]
#[ignore = "isolated PostgreSQL and Oracle enterprise lab"]
async fn enterprise_controls_and_executor_locks() {
    let settings: Value = serde_json::from_str(
        &std::fs::read_to_string(std::env::var("L8DB_VERSIONING_LAB").unwrap()).unwrap(),
    )
    .unwrap();
    for kind in [DatabaseKind::Postgres, DatabaseKind::Oracle] {
        let pool = db::pool::create_pool_state();
        let transactions = db::transaction::create_transaction_state();
        let raw = settings[if kind == DatabaseKind::Oracle {
            "oracleUrl"
        } else {
            "postgresUrl"
        }]
        .as_str()
        .unwrap();
        let parsed = url::Url::parse(raw).unwrap();
        assert_eq!(parsed.host_str(), Some("127.0.0.1"));
        assert!([Some(55440), Some(55441)].contains(&parsed.port()));
        let schema = if kind == DatabaseKind::Oracle {
            "L8DB_VCS_EDGE"
        } else {
            "l8db_enterprise_edge"
        };
        let connection = Connection {
            kind,
            connection_string: raw.into(),
            database: if kind == DatabaseKind::Oracle {
                None
            } else {
                Some("l8db_versioning_edge".into())
            },
            schema: schema.into(),
            project_id: "enterprise-edge".into(),
            read_only: false,
        };
        let adapter = connection.adapter(pool.clone()).unwrap();
        if kind == DatabaseKind::Postgres {
            adapter
                .execute_query(&format!("DROP SCHEMA IF EXISTS {schema} CASCADE"))
                .await
                .unwrap();
            adapter
                .execute_query(&format!("CREATE SCHEMA {schema}"))
                .await
                .unwrap();
        } else {
            let _ = adapter
                .execute_query(&format!("DROP USER {schema} CASCADE"))
                .await;
            adapter
                .execute_query(&format!("CREATE USER {schema} NO AUTHENTICATION"))
                .await
                .unwrap();
            adapter
                .execute_query(&format!("ALTER USER {schema} QUOTA UNLIMITED ON USERS"))
                .await
                .unwrap();
        }
        let user = control::actor(adapter.as_ref(), &connection).await.unwrap();
        let policy = Policy {
            track: "main".into(),
            pinned_release: None,
            paused: false,
            production: true,
            require_approval: false,
            operators: vec![],
            administrators: vec![],
            reviewers: vec![],
        };
        control::initialize(adapter.as_ref(), &connection, &policy)
            .await
            .unwrap();
        let record = control::policy(adapter.as_ref(), &connection)
            .await
            .unwrap();
        assert_eq!(record.revision, 1);
        assert_eq!(record.policy.administrators, vec![user.clone()]);
        let mut save = request(&connection, "save-policy");
        save.revision = Some(1);
        save.policy = Some(record.policy.clone());
        control::handle(save, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let mut stale = request(&connection, "save-policy");
        stale.revision = Some(1);
        stale.policy = Some(record.policy.clone());
        assert!(control::handle(stale, pool.clone(), transactions.clone())
            .await
            .unwrap_err()
            .contains("inzwischen"));
        let rowlock = control::lock(&connection, &[], &transactions, &pool)
            .await
            .unwrap();
        let other = db::transaction::create_transaction_state();
        assert!(control::lock(&connection, &[], &other, &pool)
            .await
            .is_err());
        transactions.rollback(&rowlock).await.unwrap();
        let tx = transactions
            .begin(kind, raw, connection.database.as_deref(), &pool)
            .await
            .unwrap();
        control::execution_lock(&connection, &tx, &transactions)
            .await
            .unwrap();
        if kind == DatabaseKind::Oracle {
            transactions
                .execute(
                    &tx,
                    &format!("CREATE TABLE {schema}.LOCK_PROBE (id NUMBER)"),
                )
                .await
                .unwrap();
        }
        let denied = control::handle(
            request(&connection, "recovery-lock"),
            pool.clone(),
            other.clone(),
        )
        .await;
        assert!(
            denied.is_err(),
            "active executor must block recovery even without coordinator lock"
        );
        transactions.rollback(&tx).await.unwrap();
        let accepted = control::handle(
            request(&connection, "recovery-lock"),
            pool.clone(),
            other.clone(),
        )
        .await
        .unwrap();
        other.rollback(accepted.as_str().unwrap()).await.unwrap();
        let body = json!({"large":"Grüße 🦀'".repeat(12000)});
        control::append(
            adapter.as_ref(),
            &connection,
            "large",
            "large_payload",
            &body,
        )
        .await
        .unwrap();
        let journal = control::handle(
            request(&connection, "journal"),
            pool.clone(),
            transactions.clone(),
        )
        .await
        .unwrap();
        let entry = journal
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["EVENT"] == "large_payload")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(entry["BODY"].as_str().unwrap()).unwrap(),
            body
        );
        let mut next = control::policy(adapter.as_ref(), &connection)
            .await
            .unwrap();
        next.policy.require_approval = true;
        next.policy.reviewers = vec![user.clone()];
        let mut save = request(&connection, "save-policy");
        save.revision = Some(next.revision);
        save.policy = Some(next.policy);
        control::handle(save, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let content = json!({"policyRevision":3,"sql":["SELECT 1"]}).to_string();
        let mut review = request(&connection, "request-review");
        review.body = Some(json!(content));
        let artifact = control::handle(review, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let mut approval = request(&connection, "approve");
        approval.artifact = artifact.as_str().map(str::to_owned);
        assert!(
            control::handle(approval, pool.clone(), transactions.clone())
                .await
                .unwrap_err()
                .contains("selbst")
        );
        let mut authorize = request(&connection, "authorize");
        authorize.revision = Some(3);
        authorize.artifact = artifact.as_str().map(str::to_owned);
        assert!(
            control::handle(authorize, pool.clone(), transactions.clone())
                .await
                .is_err()
        );
        let reviewer_name = if kind == DatabaseKind::Oracle {
            "L8DB_VCS_REVIEWER"
        } else {
            "l8db_vcs_reviewer"
        };
        let password = format!(
            "L8db{}",
            &control::hash(&format!(
                "{raw}{}",
                chrono::Utc::now().timestamp_nanos_opt().unwrap()
            ))[..20]
        );
        if kind == DatabaseKind::Oracle {
            let create = format!(
                "CREATE USER {reviewer_name} IDENTIFIED BY {}",
                control::quote(&password)
            );
            if adapter.execute_query(&create).await.is_err() {
                adapter
                    .execute_query(&format!(
                        "ALTER USER {reviewer_name} IDENTIFIED BY {}",
                        control::quote(&password)
                    ))
                    .await
                    .expect("reviewer password setup");
            }
            adapter
                .execute_query(&format!("GRANT CREATE SESSION TO {reviewer_name}"))
                .await
                .unwrap();
        } else {
            let create = format!(
                "CREATE ROLE {reviewer_name} LOGIN PASSWORD {}",
                control::literal(&password)
            );
            if adapter.execute_query(&create).await.is_err() {
                adapter
                    .execute_query(&format!(
                        "ALTER ROLE {reviewer_name} LOGIN PASSWORD {}",
                        control::literal(&password)
                    ))
                    .await
                    .expect("reviewer password setup");
            }
            adapter
                .execute_query(&format!(
                    "GRANT USAGE ON SCHEMA {schema} TO {reviewer_name}"
                ))
                .await
                .unwrap();
        }
        for suffix in ["POLICY", "JOURNAL", "APPROVALS"] {
            adapter
                .execute_query(&format!(
                    "GRANT SELECT ON {} TO {reviewer_name}",
                    control::table(schema, suffix)
                ))
                .await
                .unwrap();
        }
        for suffix in ["JOURNAL", "APPROVALS"] {
            adapter
                .execute_query(&format!(
                    "GRANT INSERT ON {} TO {reviewer_name}",
                    control::table(schema, suffix)
                ))
                .await
                .unwrap();
        }
        let mut reviewer_url = parsed.clone();
        reviewer_url.set_username(reviewer_name).unwrap();
        reviewer_url.set_password(Some(&password)).unwrap();
        let mut reviewer = connection.clone();
        reviewer.connection_string = reviewer_url.to_string();
        let mut current = control::policy(adapter.as_ref(), &connection)
            .await
            .unwrap();
        current.policy.reviewers.push(reviewer_name.into());
        let mut save = request(&connection, "save-policy");
        save.revision = Some(current.revision);
        save.policy = Some(current.policy.clone());
        control::handle(save, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let mut forbidden = request(&reviewer, "save-policy");
        forbidden.revision = Some(4);
        forbidden.policy = Some(current.policy);
        assert!(
            control::handle(forbidden, pool.clone(), transactions.clone())
                .await
                .is_err()
        );
        let content = json!({"policyRevision":4,"sql":["SELECT 1"]}).to_string();
        let mut review = request(&connection, "request-review");
        review.body = Some(json!(content));
        let artifact = control::handle(review, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let mut approval = request(&reviewer, "approve");
        approval.artifact = artifact.as_str().map(str::to_owned);
        control::handle(approval, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let mut authorize = request(&connection, "authorize");
        authorize.revision = Some(4);
        authorize.artifact = artifact.as_str().map(str::to_owned);
        control::handle(authorize, pool.clone(), transactions.clone())
            .await
            .unwrap();
        adapter
            .execute_query(&format!(
                "UPDATE {} SET \"CREATED_AT\"=TIMESTAMP '2000-01-01 00:00:00'",
                control::table(schema, "APPROVALS")
            ))
            .await
            .unwrap();
        let mut expired = request(&connection, "authorize");
        expired.revision = Some(4);
        expired.artifact = artifact.as_str().map(str::to_owned);
        assert!(control::handle(expired, pool.clone(), transactions.clone())
            .await
            .is_err());
        let mut renew = request(&reviewer, "approve");
        renew.artifact = artifact.as_str().map(str::to_owned);
        control::handle(renew, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let mut renewed = request(&connection, "authorize");
        renewed.revision = Some(4);
        renewed.artifact = artifact.as_str().map(str::to_owned);
        control::handle(renewed, pool.clone(), transactions.clone())
            .await
            .unwrap();
        let mut changed = request(&connection, "authorize");
        changed.revision = Some(4);
        changed.artifact = Some(control::hash("changed SQL"));
        assert!(control::handle(changed, pool.clone(), transactions.clone())
            .await
            .is_err());
        let reviewer_adapter = reviewer.adapter(pool.clone()).unwrap();
        control::initialize(reviewer_adapter.as_ref(), &reviewer, &policy)
            .await
            .unwrap();
        if kind == DatabaseKind::Postgres {
            adapter
                .execute_query(&format!(
                    "GRANT SELECT, UPDATE ON {} TO {reviewer_name}",
                    control::table(schema, "LOCKS")
                ))
                .await
                .unwrap();
            let adoption = control::handle(
                request(&reviewer, "baseline-lock"),
                pool.clone(),
                transactions.clone(),
            )
            .await
            .unwrap();
            transactions
                .rollback(adoption.as_str().unwrap())
                .await
                .unwrap();
            assert!(control::handle(
                request(&reviewer, "recovery-lock"),
                pool.clone(),
                transactions.clone()
            )
            .await
            .is_err());
        }

        assert!(reviewer_adapter
            .execute_query(&format!(
                "UPDATE {} SET \"EVENT\"='forged'",
                control::table(schema, "JOURNAL")
            ))
            .await
            .is_err());
        let mut readonly = connection.clone();
        readonly.read_only = true;
        assert!(control::handle(
            request(&readonly, "lock"),
            pool.clone(),
            transactions.clone()
        )
        .await
        .is_err());
        if kind == DatabaseKind::Postgres {
            adapter
                .execute_query(&format!(
                    "CREATE TABLE {schema}.snapshot_probe (id integer NOT NULL)"
                ))
                .await
                .unwrap();
            let mut expected = snapshot::Snapshot {
                schema: schema.into(),
                source_schema: schema.into(),
                name: "snapshot_probe".into(),
                kind: "table".into(),
                metadata_version: None,
                definition: String::new(),
            };
            expected.definition = snapshot::definition(adapter.as_ref(), kind, &expected)
                .await
                .unwrap();
            let tx = transactions
                .begin(kind, raw, connection.database.as_deref(), &pool)
                .await
                .unwrap();
            transactions
                .execute(
                    &tx,
                    &format!("ALTER TABLE {schema}.snapshot_probe ADD wrong integer"),
                )
                .await
                .unwrap();
            let metadata = transactions
                .versioning_adapter(&tx, pool.clone())
                .await
                .unwrap();
            assert!(
                snapshot::verify(metadata.as_ref(), kind, &[expected.clone()])
                    .await
                    .is_err()
            );
            transactions.rollback(&tx).await.unwrap();
            assert_eq!(
                adapter
                    .list_table_columns_detailed(schema, "snapshot_probe")
                    .await
                    .unwrap()
                    .len(),
                1
            );
        }
        if kind == DatabaseKind::Postgres {
            lost_commit_reply(
                &connection,
                adapter.as_ref(),
                pool.clone(),
                transactions.clone(),
                settings["root"].as_str().unwrap(),
            )
            .await;
        }
        println!("enterprise controls: {kind:?} passed");
    }
}

async fn lost_commit_reply(
    connection: &Connection,
    adapter: &dyn db::DatabaseAdapter,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
    root: &str,
) {
    let schema = &connection.schema;
    let mut current = control::policy(adapter, connection).await.unwrap();
    current.policy.require_approval = false;
    let mut save = request(connection, "save-policy");
    save.revision = Some(current.revision);
    save.policy = Some(current.policy);
    let policy = control::handle(save, pool.clone(), transactions.clone())
        .await
        .unwrap();
    adapter.execute_query(&format!("CREATE TABLE {} (\"PROJECT_ID\" VARCHAR(100) PRIMARY KEY, \"RELEASE_ID\" VARCHAR(100), \"RELEASE_HASH\" VARCHAR(64), \"LEASE\" VARCHAR(64), \"STATUS\" VARCHAR(20))",control::table(schema,"STATE"))).await.unwrap();
    let from_hash = control::hash("v1");
    let to_hash = control::hash("v2");
    adapter
        .execute_query(&format!(
            "INSERT INTO {} VALUES ({},'v1',{},NULL,'ready')",
            control::table(schema, "STATE"),
            control::literal(&connection.project_id),
            control::literal(&from_hash)
        ))
        .await
        .unwrap();
    let object = snapshot::Snapshot {
        schema: schema.clone(),
        source_schema: schema.clone(),
        name: "snapshot_probe".into(),
        kind: "table".into(),
        metadata_version: None,
        definition: String::new(),
    };
    let definition = snapshot::definition(adapter, connection.kind, &object)
        .await
        .unwrap();
    let objects = json!([{"schema":schema,"sourceSchema":schema,"name":"snapshot_probe","kind":"table","definition":definition}]);
    let context=adapter.execute_query("SELECT current_database() AS \"database\", current_user AS \"user\", COALESCE(inet_server_addr()::text,'local') AS \"server\", inet_server_port()::text AS \"port\", NULL::text AS \"edition\"").await.unwrap().rows[0].clone();
    let reference = json!({"id":"v2","commit":"0000000000000000000000000000000000000000","path":"database/releases/v2.json"});
    let artifact=json!({"policyRevision":policy["revision"],"execution":{"context":context,"fromId":"v1","fromHash":from_hash,"fromObjects":objects,"reference":reference,"releases":[{"id":"v2","hash":to_hash,"objects":objects,"statements":[{"id":"v2:m:1","migration":"m","sql":format!("INSERT INTO {schema}.snapshot_probe VALUES (9)")}],"preconditions":[],"postconditions":[],"settings":["SET LOCAL statement_timeout='3000ms'"],"oracleTimeout":3000}]}}).to_string();
    let id = format!("lost-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap());
    let repo = std::path::Path::new(root).join(&id);
    std::fs::create_dir(&repo).unwrap();
    assert!(std::process::Command::new("git")
        .args(["init", "-q"])
        .arg(&repo)
        .status()
        .unwrap()
        .success());
    std::fs::write(repo.join(".git/l8db-targets.json"),json!({"format":1,"projectId":connection.project_id,"targets":[{"id":"edge","history":[],"release":{"id":"v1"}}]}).to_string()).unwrap();
    *super::runner::LOST_COMMIT.lock().unwrap() = Some(id.clone());
    let run = super::runner::Request {
        connection: connection.clone(),
        repo: repo.to_string_lossy().into_owned(),
        target_id: "edge".into(),
        run_id: id.clone(),
        artifact,
    };
    super::runner::start(run, pool, transactions).await.unwrap();
    for _ in 0..100 {
        if super::runner::status(&id).await.unwrap().status != "running" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let status = super::runner::status(&id).await.unwrap();
    *super::runner::LOST_COMMIT.lock().unwrap() = None;
    assert_eq!(status.status, "failed");
    assert!(status.error.unwrap().contains("Commit-Antwort"));
    assert_eq!(
        adapter
            .execute_query(&format!("SELECT id FROM {schema}.snapshot_probe"))
            .await
            .unwrap()
            .rows
            .len(),
        1
    );
    let ledger = adapter
        .execute_query(&format!(
            "SELECT \"RELEASE_HASH\", \"STATUS\", \"LEASE\" FROM {}",
            control::table(schema, "STATE")
        ))
        .await
        .unwrap();
    assert_eq!(ledger.rows[0]["RELEASE_HASH"], to_hash);
    assert_eq!(ledger.rows[0]["STATUS"], "failed");
    assert_eq!(ledger.rows[0]["LEASE"], id);
    let journal = adapter
        .execute_query(&format!(
            "SELECT \"EVENT\" FROM {} WHERE \"RUN_ID\"={}",
            control::table(schema, "JOURNAL"),
            control::literal(&id)
        ))
        .await
        .unwrap();
    assert!(journal
        .rows
        .iter()
        .any(|r| r["EVENT"] == "commit_requested"));
    assert!(!journal
        .rows
        .iter()
        .any(|r| r["EVENT"] == "commit_confirmed"));
    println!("lost commit reply: durable ledger advanced, rollout blocked, no automatic retry");
}
