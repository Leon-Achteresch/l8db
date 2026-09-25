use std::collections::HashMap;

use super::pool::create_pool_state;
use super::{create_adapter_from_string, DatabaseAdapter, DatabaseKind};

fn postgis_url() -> String {
    std::env::var("L8DB_E2E_POSTGIS_URL")
        .unwrap_or_else(|_| "postgresql://postgres:testpw@127.0.0.1:55498/postgres".to_string())
}

async fn run(adapter: &dyn DatabaseAdapter, sql: &str) {
    adapter
        .execute_query(sql)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

#[tokio::test]
#[ignore]
async fn postgis_pgvector_values_reach_the_viewers() {
    let adapter = create_adapter_from_string(
        DatabaseKind::Postgres,
        &postgis_url(),
        None,
        create_pool_state(),
    )
    .expect("adapter");
    for sql in [
        "CREATE EXTENSION IF NOT EXISTS postgis",
        "CREATE EXTENSION IF NOT EXISTS vector",
        "DROP TABLE IF EXISTS l8db_value_viewers",
        "CREATE TABLE l8db_value_viewers (id int PRIMARY KEY, b bytea, g geometry, gg geography, v vector(3), h halfvec(3), s sparsevec(5), x xml)",
        "INSERT INTO l8db_value_viewers VALUES (1, '\\x89504e470d0a1a0a', 'SRID=4326;POINT(1 2)', 'POINT(3 4)', '[1,2,3]', '[1.5,2,3]', '{1:0.5,3:2}/5', '<a><b>x</b></a>')",
    ] {
        run(adapter.as_ref(), sql).await;
    }

    let data = adapter
        .fetch_rows(
            "public",
            "l8db_value_viewers",
            None,
            100,
            0,
            None,
            false,
            false,
            false,
        )
        .await
        .expect("fetch");
    let row = &data.rows[0];
    assert_eq!(row["b"], "\\x89504e470d0a1a0a");
    assert_eq!(row["g"]["type"], "Point");
    assert_eq!(row["g"]["coordinates"], serde_json::json!([1, 2]));
    assert_eq!(row["g"]["crs"]["properties"]["name"], "EPSG:4326");
    assert_eq!(
        row["gg"],
        "0101000020E610000000000000000008400000000000001040"
    );
    assert_eq!(row["v"], "[1,2,3]");
    assert_eq!(row["h"], "[1.5,2,3]");
    assert_eq!(row["s"], "{1:0.5,3:2}/5");
    assert_eq!(row["x"], "<a><b>x</b></a>");

    let query = adapter
        .execute_query("SELECT b, g, v FROM l8db_value_viewers")
        .await
        .expect("query");
    assert_eq!(query.rows[0]["b"], "\\x89504e470d0a1a0a");
    assert_eq!(
        query.rows[0]["g"],
        "0101000020E6100000000000000000F03F0000000000000040"
    );
    assert_eq!(query.rows[0]["v"], "[1,2,3]");

    let ctid = row["__ctid__"].as_str().expect("ctid").to_string();
    let updates = HashMap::from([
        ("b".to_string(), Some("\\x00ff10".to_string())),
        ("g".to_string(), Some("SRID=4326;POINT (5 6)".to_string())),
        ("v".to_string(), Some("[0.5,0,-1]".to_string())),
    ]);
    adapter
        .update_row("public", "l8db_value_viewers", &ctid, &updates)
        .await
        .expect("update");
    let after = adapter
        .execute_query(
            "SELECT encode(b, 'hex') AS b, ST_AsEWKT(g) AS g, v::text AS v FROM l8db_value_viewers",
        )
        .await
        .expect("after");
    assert_eq!(after.rows[0]["b"], "00ff10");
    assert_eq!(after.rows[0]["g"], "SRID=4326;POINT(5 6)");
    assert_eq!(after.rows[0]["v"], "[0.5,0,-1]");

    run(adapter.as_ref(), "DROP TABLE l8db_value_viewers").await;
}
