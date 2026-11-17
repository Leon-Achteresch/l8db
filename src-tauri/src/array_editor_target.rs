pub fn owned_url(candidate: &str, database: &str) -> Result<String, String> {
    let url = url::Url::parse(candidate).map_err(|error| error.to_string())?;
    if !database.starts_with("l8db_a01_")
        || database.len() != 21
        || !database[9..].bytes().all(|ch| ch.is_ascii_hexdigit())
        || url.scheme() != "postgresql"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.username() != "l8db_a01"
        || url.password().is_some()
        || url.path() != format!("/{database}")
        || url.query() != Some("sslmode=disable")
        || url.fragment().is_some()
    {
        return Err("Only the explicitly owned loopback A01 cluster is permitted.".into());
    }
    Ok(candidate.to_owned())
}

#[cfg(debug_assertions)]
pub(crate) async fn open_owned_fixture() -> Result<
    (
        Box<dyn crate::db::DatabaseAdapter>,
        std::path::PathBuf,
        String,
    ),
    String,
> {
    let database = std::env::var("L8DB_A01_LOCAL_OWNED_DB").map_err(|e| e.to_string())?;
    let candidate = std::env::var("L8DB_A01_LOCAL_PG_URL").map_err(|e| e.to_string())?;
    let url = owned_url(&candidate, &database)?;
    let directory = std::env::var("L8DB_A01_LOCAL_OWNED_DIR").map_err(|e| e.to_string())?;
    let root = std::path::Path::new(&directory)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let temp = std::env::temp_dir()
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if root.parent() != Some(temp.as_path())
        || !root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .starts_with("l8db-a01-pg.")
        || std::fs::read_to_string(root.join("a01-owner")).map_err(|e| e.to_string())? != database
    {
        return Err("Eigene A01-Clusterdateigrenze fehlt.".into());
    }
    let adapter = crate::db::create_adapter_from_string(
        crate::db::DatabaseKind::Postgres,
        &url,
        None,
        crate::db::pool::create_pool_state(),
    )?;
    let identity = adapter.execute_query("SELECT current_database() AS db, current_user AS usr, current_setting('cluster_name') AS marker, inet_server_addr()::text AS host").await?;
    let identity = identity.rows.first().ok_or("Clusterkennung fehlt.")?;
    if identity["db"] != database
        || identity["marker"] != database
        || identity["usr"] != "l8db_a01"
        || identity["host"] != "127.0.0.1/32"
    {
        return Err("Fremder PostgreSQL-Cluster: kein Fixturezugriff.".into());
    }
    Ok((adapter, root, database))
}
