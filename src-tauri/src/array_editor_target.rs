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
