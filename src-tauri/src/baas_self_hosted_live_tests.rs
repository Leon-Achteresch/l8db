use crate::convex::{
    convex_connect_self_hosted, convex_delete_environment_variable, convex_deployments,
    convex_disconnect, convex_environment_variables, convex_profiles, convex_projects,
    convex_set_environment_variable,
};
use crate::db::pool::create_pool_state;
use crate::db::{create_adapter_from_string, DatabaseKind};
use crate::supabase::*;

pub(crate) fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

pub(crate) fn isolate_secrets() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    std::env::set_var("L8DB_DEV_SECRETS", directory.path().join("secrets.json"));
    directory
}

pub(crate) async fn latency<F, Fut>(label: &str, budget_ms: u128, mut run: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let mut samples = Vec::new();
    for _ in 0..20 {
        let started = std::time::Instant::now();
        run().await;
        samples.push(started.elapsed().as_millis());
    }
    samples.sort_unstable();
    let (median, p95) = (samples[10], samples[18]);
    println!("{label}: median {median} ms, p95 {p95} ms");
    assert!(p95 <= budget_ms, "{label}: p95 {p95} ms > {budget_ms} ms");
}

pub(crate) async fn pg_query(url: &str, key: &str, query: &str) -> serde_json::Value {
    let response = reqwest::Client::new()
        .post(format!("{}/pg/query", url.trim_end_matches('/')))
        .header("apikey", key)
        .bearer_auth(key)
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success(), "{}", response.status());
    response.json().await.unwrap()
}

#[tokio::test]
#[ignore]
async fn supabase_self_hosted_live() {
    let (Some(url), Some(key)) = (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
    else {
        return;
    };
    let _secrets = isolate_secrets();

    assert!(
        supabase_connect_self_hosted(url.clone(), "sb_publishable_x".into(), "Lab".into())
            .await
            .is_err()
    );
    assert!(
        supabase_connect_self_hosted("http://127.0.0.1:9/".into(), key.clone(), "Lab".into())
            .await
            .is_err()
    );
    assert!(!supabase_is_connected().await.unwrap());

    let project = supabase_connect_self_hosted(url.clone(), key.clone(), " Lab ".into())
        .await
        .unwrap();
    let reference = project.reference.clone();
    assert!(project.self_hosted);
    assert_eq!(project.name, "Lab");
    assert!(supabase_is_connected().await.unwrap());
    let projects = supabase_projects().await.unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].reference, reference);
    assert!(supabase_has_project_key(reference.clone()).await.unwrap());

    let health = supabase_health(reference.clone()).await.unwrap();
    assert_eq!(health.len(), 5);
    assert!(health.iter().all(|service| service.healthy), "{health:?}");

    for unsupported in [
        supabase_functions(reference.clone()).await.err(),
        supabase_backups(reference.clone()).await.err(),
        supabase_import_project_key(reference.clone()).await.err(),
        supabase_delete_function(reference.clone(), "x".into())
            .await
            .err(),
    ] {
        assert!(unsupported.unwrap().contains("selbst gehosteten"));
    }

    pg_query(
        &url,
        &key,
        "DROP TABLE IF EXISTS public.l8db_lab; CREATE TABLE public.l8db_lab (id int PRIMARY KEY, name text NOT NULL); INSERT INTO public.l8db_lab SELECT n, 'row ' || n FROM generate_series(1, 60) n",
    )
    .await;
    let mut offset = 0;
    let mut found = false;
    loop {
        let page = supabase_tables(reference.clone(), offset).await.unwrap();
        found |= page
            .tables
            .iter()
            .any(|table| table.schema == "public" && table.name == "l8db_lab");
        if !page.has_more {
            break;
        }
        offset += 100;
    }
    assert!(found);
    let columns = supabase_table_columns(reference.clone(), "public".into(), "l8db_lab".into())
        .await
        .unwrap();
    assert_eq!(
        columns
            .iter()
            .map(|column| (column.name.as_str(), column.is_nullable.as_str()))
            .collect::<Vec<_>>(),
        [("id", "NO"), ("name", "NO")]
    );
    let first = supabase_table_rows(reference.clone(), "public".into(), "l8db_lab".into(), 0)
        .await
        .unwrap();
    assert_eq!(first.rows.len(), 50);
    assert!(first.has_more);
    assert_eq!(first.rows[0].values["name"], "row 1");
    let second = supabase_table_rows(reference.clone(), "public".into(), "l8db_lab".into(), 50)
        .await
        .unwrap();
    assert_eq!(second.rows.len(), 10);
    assert!(!second.has_more);
    assert_eq!(second.rows[0].ordinal, 51);
    assert!(supabase_table_columns(
        reference.clone(),
        "public".into(),
        "l8db_lab'; DROP TABLE public.l8db_lab; --".into()
    )
    .await
    .unwrap()
    .is_empty());
    latency("supabase rows page", 500, || async {
        let page = supabase_table_rows(reference.clone(), "public".into(), "l8db_lab".into(), 0)
            .await
            .unwrap();
        assert_eq!(page.rows.len(), 50);
    })
    .await;
    latency("supabase health", 500, || async {
        assert_eq!(supabase_health(reference.clone()).await.unwrap().len(), 5);
    })
    .await;
    pg_query(&url, &key, "DROP TABLE public.l8db_lab").await;

    let bucket = "l8db-lab".to_string();
    for leftover in ["docs/hello.txt", "moved/hello.txt"] {
        let _ = supabase_delete_object(reference.clone(), bucket.clone(), leftover.into()).await;
    }
    let _ = supabase_delete_bucket(reference.clone(), bucket.clone()).await;
    supabase_create_bucket(reference.clone(), bucket.clone(), false)
        .await
        .unwrap();
    assert!(supabase_buckets(reference.clone())
        .await
        .unwrap()
        .iter()
        .any(|item| item.id == bucket && !item.public));
    supabase_update_bucket_public(reference.clone(), bucket.clone(), true)
        .await
        .unwrap();
    assert!(
        supabase_bucket_details(reference.clone(), bucket.clone())
            .await
            .unwrap()
            .public
    );
    let upload = reqwest::Client::new()
        .post(format!(
            "{}/storage/v1/object/{bucket}/docs/hello.txt",
            url.trim_end_matches('/')
        ))
        .header("apikey", &key)
        .bearer_auth(&key)
        .header("content-type", "text/plain")
        .body("hello lab")
        .send()
        .await
        .unwrap();
    assert!(upload.status().is_success(), "{}", upload.status());
    let root = supabase_objects(reference.clone(), bucket.clone(), String::new(), 0)
        .await
        .unwrap();
    assert!(root
        .iter()
        .any(|object| object.name == "docs" && object.id.is_none()));
    let files = supabase_objects(reference.clone(), bucket.clone(), "docs/".into(), 0)
        .await
        .unwrap();
    assert!(files.iter().any(|object| object.name == "hello.txt"));
    let preview = serde_json::to_value(
        supabase_preview_object(reference.clone(), bucket.clone(), "docs/hello.txt".into())
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(preview["base64"], "aGVsbG8gbGFi", "{preview}");
    supabase_move_object(
        reference.clone(),
        bucket.clone(),
        "docs/hello.txt".into(),
        "moved/hello.txt".into(),
    )
    .await
    .unwrap();
    supabase_delete_object(reference.clone(), bucket.clone(), "moved/hello.txt".into())
        .await
        .unwrap();
    supabase_delete_bucket(reference.clone(), bucket.clone())
        .await
        .unwrap();

    let email = format!("lab-{}@example.com", std::process::id());
    supabase_create_auth_user(reference.clone(), email.clone(), "secret-pw".into())
        .await
        .unwrap();
    let users = supabase_auth_users(reference.clone(), 1).await.unwrap();
    let user = users
        .users
        .iter()
        .find(|user| user.email.as_deref() == Some(email.as_str()))
        .unwrap();
    let renamed = format!("renamed-{email}");
    supabase_update_auth_user_email(reference.clone(), user.id.clone(), renamed.clone())
        .await
        .unwrap();
    assert!(supabase_auth_users(reference.clone(), 1)
        .await
        .unwrap()
        .users
        .iter()
        .any(|item| item.id == user.id && item.email.as_deref() == Some(renamed.as_str())));
    supabase_delete_auth_user(reference.clone(), user.id.clone())
        .await
        .unwrap();

    let endpoint = supabase_database_endpoint(reference.clone()).await.unwrap();
    assert_eq!(endpoint.user, "postgres.your-tenant-id");
    if let Some(password) = env("L8DB_E2E_SUPABASE_DB_PASSWORD") {
        let port = env("L8DB_E2E_SUPABASE_DB_PORT").unwrap_or_else(|| endpoint.port.to_string());
        let connection = format!(
            "postgresql://{}:{password}@{}:{port}/{}?sslmode=prefer",
            endpoint.user, endpoint.host, endpoint.database
        );
        create_adapter_from_string(
            DatabaseKind::Postgres,
            &connection,
            None,
            create_pool_state(),
        )
        .unwrap()
        .test_connection()
        .await
        .unwrap();
    }

    supabase_disconnect().await.unwrap();
    assert!(supabase_is_connected().await.unwrap());
    assert!(supabase_has_project_key(reference.clone()).await.unwrap());
    supabase_disconnect_self_hosted(reference.clone())
        .await
        .unwrap();
    assert!(!supabase_is_connected().await.unwrap());
    assert!(!supabase_has_project_key(reference.clone()).await.unwrap());
    assert!(supabase_projects().await.unwrap().is_empty());
}

#[tokio::test]
#[ignore]
async fn supabase_public_key_live() {
    let (Some(url), Some(key), Some(public_keys)) = (
        env("L8DB_E2E_SUPABASE_URL"),
        env("L8DB_E2E_SUPABASE_KEY"),
        env("L8DB_E2E_SUPABASE_PUBLIC_KEYS"),
    ) else {
        return;
    };
    let _secrets = isolate_secrets();
    pg_query(
        &url,
        &key,
        "DROP TABLE IF EXISTS public.l8db_public; CREATE TABLE public.l8db_public (id int PRIMARY KEY, label text); INSERT INTO public.l8db_public SELECT n, 'row ' || n FROM generate_series(1, 60) n; GRANT SELECT ON public.l8db_public TO anon; NOTIFY pgrst, 'reload schema'",
    )
    .await;
    for public_key in public_keys.split(',') {
        let project = supabase_connect_self_hosted(
            format!("NEXT_PUBLIC_SUPABASE_URL=\"{url}\""),
            format!("NEXT_PUBLIC_SUPABASE_ANON_KEY={public_key}"),
            String::new(),
        )
        .await
        .unwrap();
        let reference = project.reference.clone();
        assert!(project.self_hosted);
        assert!(!project.secret_key);
        assert!(project.name.starts_with("Supabase "));

        let health = supabase_health(reference.clone()).await.unwrap();
        assert_eq!(health.len(), 4);
        assert!(health.iter().all(|service| service.healthy), "{health:?}");
        assert!(supabase_tables(reference.clone(), 0)
            .await
            .err()
            .unwrap()
            .contains("Tabellenliste"));
        assert!(
            supabase_table_columns(reference.clone(), "public".into(), "l8db_public".into())
                .await
                .unwrap()
                .is_empty()
        );
        let mut first =
            supabase_table_rows(reference.clone(), "public".into(), "l8db_public".into(), 0).await;
        for _ in 0..50 {
            if first.is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            first =
                supabase_table_rows(reference.clone(), "public".into(), "l8db_public".into(), 0)
                    .await;
        }
        let first = first.unwrap();
        assert_eq!(first.rows.len(), 50);
        assert!(first.has_more);
        assert_eq!(first.rows[0].values["label"], "row 1");
        let second =
            supabase_table_rows(reference.clone(), "public".into(), "l8db_public".into(), 50)
                .await
                .unwrap();
        assert_eq!(second.rows.len(), 10);
        assert!(!second.has_more);
        assert!(supabase_table_rows(
            reference.clone(),
            "public".into(),
            "missing_table".into(),
            0
        )
        .await
        .err()
        .unwrap()
        .contains("nicht gefunden"));
        supabase_buckets(reference.clone()).await.unwrap();
        assert!(supabase_auth_users(reference.clone(), 1).await.is_err());
        latency("supabase public rows page", 500, || async {
            supabase_table_rows(reference.clone(), "public".into(), "l8db_public".into(), 0)
                .await
                .unwrap();
        })
        .await;
        supabase_disconnect_self_hosted(reference).await.unwrap();
    }
    assert!(supabase_connect_self_hosted(
        url.clone(),
        "sb_publishable_wrong".into(),
        String::new()
    )
    .await
    .is_err());
    assert!(
        supabase_connect_self_hosted(url.clone(), "not-a-key".into(), String::new())
            .await
            .is_err()
    );
    assert!(supabase_projects().await.unwrap().is_empty());
    pg_query(&url, &key, "DROP TABLE public.l8db_public").await;
}

#[tokio::test]
#[ignore]
async fn convex_self_hosted_live() {
    let (Some(url), Some(key)) = (env("L8DB_E2E_CONVEX_URL"), env("L8DB_E2E_CONVEX_KEY")) else {
        return;
    };
    let _secrets = isolate_secrets();

    assert!(
        convex_connect_self_hosted(url.clone(), "convex-self-hosted|00".into())
            .await
            .is_err()
    );
    let profile = convex_connect_self_hosted(url.clone(), key.clone())
        .await
        .unwrap();
    assert_eq!(profile.team_id, 0);
    assert!(profile.url.is_some());
    assert_eq!(convex_profiles().await.unwrap().len(), 1);
    assert!(convex_projects(profile.id.clone(), None).await.is_err());
    assert!(convex_deployments(profile.id.clone(), 0).await.is_err());

    let deployment = String::new();
    latency("convex environment", 500, || async {
        convex_environment_variables(profile.id.clone(), 0, String::new())
            .await
            .unwrap();
    })
    .await;
    convex_set_environment_variable(
        profile.id.clone(),
        0,
        deployment.clone(),
        "L8DB_LAB".into(),
        "value".into(),
    )
    .await
    .unwrap();
    assert!(
        convex_environment_variables(profile.id.clone(), 0, deployment.clone())
            .await
            .unwrap()
            .contains(&"L8DB_LAB".to_string())
    );
    convex_delete_environment_variable(
        profile.id.clone(),
        0,
        deployment.clone(),
        "L8DB_LAB".into(),
    )
    .await
    .unwrap();
    assert!(
        !convex_environment_variables(profile.id.clone(), 0, deployment)
            .await
            .unwrap()
            .contains(&"L8DB_LAB".to_string())
    );

    convex_disconnect(profile.id).await.unwrap();
    assert!(convex_profiles().await.unwrap().is_empty());
}
