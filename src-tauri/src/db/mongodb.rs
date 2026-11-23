use async_trait::async_trait;
use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::Client;

use super::pool::PoolState;
use super::{
    timed, unsupported, ColumnInfo, CreateTableRequest, DatabaseAdapter, DetailedColumnInfo,
    IndexInfo, QueryResult, TableData, TableInfo,
};

pub struct MongoAdapter {
    uri: String,
    database: Option<String>,
    pool_state: PoolState,
    key: String,
}

pub const FIELD_SAMPLE: usize = 1000;

static CLIENTS: std::sync::Mutex<Option<Vec<Client>>> = std::sync::Mutex::new(None);

pub fn track_clients() {
    if let Ok(mut clients) = CLIENTS.lock() {
        clients.get_or_insert_with(Vec::new);
    }
}

pub async fn close_clients() {
    let clients = CLIENTS
        .lock()
        .ok()
        .and_then(|mut clients| clients.take())
        .unwrap_or_default();
    for client in clients {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), client.shutdown()).await;
    }
}

fn map_err(e: mongodb::error::Error) -> String {
    format!("MongoDB: {}", describe_error(&e))
}

fn describe_error(e: &mongodb::error::Error) -> String {
    use mongodb::error::{ErrorKind, WriteFailure};
    match e.kind.as_ref() {
        ErrorKind::Command(c) => server_error(c.code, &c.code_name, &c.message),
        ErrorKind::Write(WriteFailure::WriteError(w)) => {
            server_error(w.code, w.code_name.as_deref().unwrap_or(""), &w.message)
        }
        ErrorKind::Write(WriteFailure::WriteConcernError(w)) => {
            server_error(w.code, &w.code_name, &w.message)
        }
        ErrorKind::InsertMany(failure) => match (&failure.write_errors, &failure.write_concern_error)
        {
            (Some(errors), _) if !errors.is_empty() => format!(
                "Dokument {}: {}",
                errors[0].index + 1,
                server_error(
                    errors[0].code,
                    errors[0].code_name.as_deref().unwrap_or(""),
                    &errors[0].message
                )
            ),
            (_, Some(w)) => server_error(w.code, &w.code_name, &w.message),
            _ => e.kind.to_string(),
        },
        ErrorKind::Authentication { message, .. } => auth_error(message),
        ErrorKind::ServerSelection { message, .. } => unreachable_error(message),
        ErrorKind::DnsResolve { message, .. } if message.contains("no records found") => {
            "DNS: Für den Host der mongodb+srv-URL gibt es keinen SRV-Eintrag. Hostnamen prüfen."
                .into()
        }
        ErrorKind::DnsResolve { .. } => {
            "DNS-Auflösung fehlgeschlagen. Hostnamen der URL prüfen.".into()
        }
        ErrorKind::InvalidArgument { message, .. } if message.contains("No username provided") => {
            "Die URL enthält keinen Benutzer, das Anmeldeverfahren verlangt aber einen: mongodb://benutzer:passwort@host/db".into()
        }
        ErrorKind::InvalidArgument { message, .. } => format!("Ungültige Angabe: {message}"),
        ErrorKind::Io(error) => network_error(&error.to_string()),
        kind => kind.to_string(),
    }
}

fn server_error(code: i32, name: &str, message: &str) -> String {
    let message = message
        .rsplit(" :: caused by :: ")
        .next()
        .unwrap_or(message);
    match code {
        13 if message.contains("requires authentication") => "Anmeldung nötig: Der Server verlangt Benutzer und Passwort, z. B. mongodb://benutzer:passwort@host/db?authSource=admin".into(),
        13 if message.contains("only be run against the admin database") => format!(
            "Nur in der Datenbank „admin“ erlaubt. Verbindung mit /admin öffnen und den Befehl dort ausführen. (Code 13: {message})"
        ),
        13 => format!("Keine Berechtigung: {message}"),
        18 => auth_error(message),
        2 if message.contains("hint provided does not correspond to an existing index") => format!(
            "Der Index aus hint() existiert nicht. Indexnamen mit getIndexes() prüfen. (Code 2, BadValue: {message})"
        ),
        11000 => format!("Wert verletzt einen eindeutigen Index: {message} (Code 11000)"),
        _ if name.is_empty() => format!("Vom Server abgelehnt: {message} (Code {code})"),
        _ => format!("Vom Server abgelehnt: {message} (Code {code}, {name})"),
    }
}

fn auth_error(message: &str) -> String {
    if message.contains("Authentication failed") || message.contains("AuthenticationFailed") {
        "Anmeldung fehlgeschlagen. Prüfe Benutzer und Datenbankpasswort. Liegt der Benutzer in einer anderen Datenbank, authSource angeben, z. B. ?authSource=admin".into()
    } else {
        format!("Anmeldung fehlgeschlagen: {message}")
    }
}

fn network_error(message: &str) -> String {
    if message.contains("Connection refused") {
        "Verbindung abgelehnt. Läuft der Server, stimmen Host und Port?".into()
    } else if message.contains("timed out") {
        "Zeitüberschreitung beim Verbinden.".into()
    } else {
        format!("Netzwerkfehler: {message}")
    }
}

fn unreachable_error(message: &str) -> String {
    if message.contains("SCRAM") || message.contains("Authentication") {
        return auth_error(message);
    }
    let mut addresses: Vec<&str> = message
        .split("Address: ")
        .skip(1)
        .filter_map(|part| part.split([',', ' ']).next())
        .collect();
    addresses.dedup();
    let reason = if message.contains("Connection refused") {
        "Verbindung abgelehnt"
    } else if message.contains("certificate") || message.contains("TLS") {
        "TLS-Fehler, Zertifikat prüfen"
    } else if message.contains("None of the available servers suitable") {
        "kein passender Server, replicaSet und readPreference prüfen"
    } else if message.contains("timed out") || message.contains("Timed out") {
        "Zeitüberschreitung"
    } else {
        "keine Antwort"
    };
    if addresses.is_empty() {
        format!("Server nicht erreichbar: {reason}.")
    } else {
        format!(
            "Server {} nicht erreichbar: {reason}.",
            addresses.join(", ")
        )
    }
}

fn write_error(errors: &[Bson]) -> String {
    let first = errors.first().and_then(Bson::as_document);
    let text = first.map_or_else(String::new, |error| {
        server_error(
            error.get_i32("code").unwrap_or(0),
            error.get_str("codeName").unwrap_or(""),
            error.get_str("errmsg").unwrap_or(""),
        )
    });
    match errors.len() {
        0 | 1 => format!("MongoDB: {text}"),
        n => format!("MongoDB: {text} (+{} weitere Schreibfehler)", n - 1),
    }
}

async fn collect_capped<T, E>(
    stream: impl futures_util::Stream<Item = Result<T, E>>,
    cap: usize,
) -> Result<(Vec<T>, bool), E> {
    let mut stream = std::pin::pin!(stream);
    let mut items = Vec::new();
    while let Some(item) = stream.try_next().await? {
        if items.len() == cap {
            return Ok((items, true));
        }
        items.push(item);
    }
    Ok((items, false))
}

fn to_json(bson: Bson) -> serde_json::Value {
    match bson {
        Bson::Int64(value)
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&value) =>
        {
            serde_json::json!({ "$numberLong": value.to_string() })
        }
        Bson::Document(document) => serde_json::Value::Object(
            document
                .into_iter()
                .map(|(key, value)| (key, to_json(value)))
                .collect(),
        ),
        Bson::Array(values) => serde_json::Value::Array(values.into_iter().map(to_json).collect()),
        Bson::DateTime(date) => match date.try_to_rfc3339_string() {
            Ok(text) => serde_json::json!({ "$date": text }),
            Err(_) => Bson::DateTime(date).into_relaxed_extjson(),
        },
        value => value.into_relaxed_extjson(),
    }
}

pub fn shell_rows(rows: &[serde_json::Value]) -> Vec<serde_json::Value> {
    rows.iter()
        .map(|row| match row {
            serde_json::Value::Object(fields) => serde_json::Value::Object(
                fields
                    .iter()
                    .map(|(key, value)| (key.clone(), shell_cell(value)))
                    .collect(),
            ),
            other => shell_cell(other),
        })
        .collect()
}

fn shell_cell(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
            serde_json::Value::String(shell_text(value))
        }
        other => other.clone(),
    }
}

pub fn shell_text(value: &serde_json::Value) -> String {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            if let Some(text) = shell_wrapper(map) {
                return text;
            }
            if map.is_empty() {
                return "{}".into();
            }
            let fields: Vec<String> = map
                .iter()
                .map(|(key, value)| {
                    let plain = key.chars().enumerate().all(|(i, c)| {
                        c == '_'
                            || c == '$'
                            || c.is_ascii_alphabetic()
                            || (i > 0 && c.is_ascii_digit())
                    });
                    let key = if plain && !key.is_empty() {
                        key.clone()
                    } else {
                        Value::String(key.clone()).to_string()
                    };
                    format!("{key}: {}", shell_text(value))
                })
                .collect();
            format!("{{ {} }}", fields.join(", "))
        }
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(shell_text).collect::<Vec<_>>().join(", ")
        ),
        other => other.to_string(),
    }
}

fn shell_wrapper(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    use base64::Engine;
    use serde_json::Value;
    let (key, inner) = map.iter().next()?;
    if map.len() != 1 && key != "$code" {
        return None;
    }
    let quoted = |text: &str| Value::String(text.to_string()).to_string();
    let field = |name: &str| inner.get(name).cloned().unwrap_or(Value::Null);
    Some(match (key.as_str(), inner) {
        ("$oid", Value::String(id)) => format!("ObjectId({})", quoted(id)),
        ("$numberLong", Value::String(n)) => format!("NumberLong({})", quoted(n)),
        ("$numberDecimal", Value::String(n)) => format!("NumberDecimal({})", quoted(n)),
        ("$numberDouble" | "$numberInt", Value::String(n)) => n.clone(),
        ("$date", Value::String(date)) => format!("ISODate({})", quoted(date)),
        ("$date", Value::Object(_)) => {
            let millis: i64 = field("$numberLong").as_str()?.parse().ok()?;
            match mongodb::bson::DateTime::from_millis(millis).try_to_rfc3339_string() {
                Ok(date) => format!("ISODate({})", quoted(&date)),
                Err(_) => format!("new Date({millis})"),
            }
        }
        ("$binary", Value::Object(_)) => {
            let data = field("base64").as_str()?.to_string();
            let subtype = u8::from_str_radix(field("subType").as_str()?, 16).ok()?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&data)
                .unwrap_or_default();
            if subtype == 4 && bytes.len() == 16 {
                let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                format!(
                    "UUID(\"{}-{}-{}-{}-{}\")",
                    &hex[..8],
                    &hex[8..12],
                    &hex[12..16],
                    &hex[16..20],
                    &hex[20..]
                )
            } else {
                format!("BinData({subtype}, {})", quoted(&data))
            }
        }
        ("$timestamp", Value::Object(_)) => {
            format!("Timestamp({}, {})", field("t"), field("i"))
        }
        ("$regularExpression", Value::Object(_)) => format!(
            "/{}/{}",
            field("pattern").as_str()?,
            field("options").as_str().unwrap_or_default()
        ),
        ("$code", Value::String(code)) => format!("Code({})", quoted(code)),
        ("$symbol", Value::String(symbol)) => quoted(symbol),
        ("$minKey", _) => "MinKey()".into(),
        ("$maxKey", _) => "MaxKey()".into(),
        ("$undefined", _) => "undefined".into(),
        _ => return None,
    })
}

pub(crate) fn parse_document(input: &str, what: &str) -> Result<Document, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(Document::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| json_error(what, trimmed, &e))?;
    match Bson::try_from(value).map_err(|e| format!("{what} konnte nicht gelesen werden: {e}"))? {
        Bson::Document(document) => Ok(document),
        _ => Err(format!("{what} muss ein JSON-Objekt sein")),
    }
}

fn json_error(what: &str, input: &str, error: &serde_json::Error) -> String {
    let reason = if error.is_eof() {
        "unvollständig, eine Klammer oder ein Anführungszeichen fehlt".to_string()
    } else {
        format!("Zeile {}, Spalte {}", error.line(), error.column())
    };
    let example = if what == "Der Filter" {
        "{\"status\": \"open\"}"
    } else {
        "db.users.find({}) oder {\"find\": \"users\"}"
    };
    let sql = if what == "Der Filter" && !input.starts_with('{') {
        " SQL-Bedingungen gelten bei MongoDB nicht."
    } else {
        ""
    };
    format!("{what} muss gültiges JSON sein ({reason}), z. B. {example}.{sql}")
}

pub fn checked_uri(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if !(trimmed.starts_with("mongodb://") || trimmed.starts_with("mongodb+srv://")) {
        return Err("Eine mongodb:// oder mongodb+srv:// URL ist erforderlich".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn endpoint(value: &str) -> Result<super::endpoint::EndpointIdentity, String> {
    use mongodb::options::{ConnectionString, HostInfo, ServerAddress, Tls};
    let uri = checked_uri(value)?;
    let parsed = ConnectionString::parse(&uri).map_err(map_err)?;
    let (host, port, srv) = match &parsed.host_info {
        HostInfo::DnsRecord(record) => (record.clone(), None, true),
        HostInfo::HostIdentifiers(hosts) => match hosts.first() {
            Some(ServerAddress::Tcp { host, port }) => {
                (host.clone(), Some(port.unwrap_or(27017)), false)
            }
            _ => (String::new(), None, false),
        },
        _ => (String::new(), None, false),
    };
    let relaxed = url::Url::parse(&uri)
        .map(|url| {
            url.query_pairs().any(|(key, value)| {
                ["tlsallowinvalidhostnames", "tlsinsecure"]
                    .contains(&key.to_ascii_lowercase().as_str())
                    && value.eq_ignore_ascii_case("true")
            })
        })
        .unwrap_or(false);
    let (tls, verify) = match &parsed.tls {
        Some(Tls::Enabled(options)) => (
            true,
            options.allow_invalid_certificates != Some(true) && !relaxed,
        ),
        Some(Tls::Disabled) => (false, false),
        None => (srv, srv && !relaxed),
    };
    let credential = parsed.credential.as_ref();
    Ok(super::endpoint::EndpointIdentity {
        host: host.trim_matches(['[', ']']).to_ascii_lowercase(),
        port,
        transport: if srv { "mongodb+srv" } else { "mongodb" }.to_string(),
        tls,
        verify,
        database: parsed.default_database.clone().unwrap_or_default(),
        schema: String::new(),
        user: credential
            .and_then(|credential| credential.username.clone())
            .unwrap_or_default(),
        params: super::endpoint::identity_params(&[
            ("replicaSet", parsed.replica_set.clone()),
            (
                "authSource",
                credential.and_then(|credential| credential.source.clone()),
            ),
        ]),
    })
}

impl MongoAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        Ok(Self {
            uri: checked_uri(connection_string)?,
            database: database.filter(|d| !d.is_empty()).map(str::to_string),
            pool_state,
            key,
        })
    }

    async fn client(&self) -> Result<Client, String> {
        let uri = self.uri.clone();
        let shared = self
            .pool_state
            .shared(
                &format!(
                    "{}#connect-{}",
                    self.key,
                    super::execution::connection_duration().as_secs()
                ),
                || async move {
                    let mut options = mongodb::options::ClientOptions::parse(&uri)
                        .await
                        .map_err(map_err)?;
                    options.server_selection_timeout =
                        Some(super::execution::connection_duration());
                    options.connect_timeout = Some(super::execution::connection_duration());
                    options.app_name.get_or_insert_with(|| "l8db".to_string());
                    let client = Client::with_options(options).map_err(map_err)?;
                    if let Ok(mut clients) = CLIENTS.lock() {
                        if let Some(clients) = clients.as_mut() {
                            clients.push(client.clone());
                        }
                    }
                    Ok(client)
                },
            )
            .await?;
        Ok((*shared).clone())
    }

    async fn database_name(&self, client: &Client) -> Result<String, String> {
        if let Some(db) = &self.database {
            return Ok(db.clone());
        }
        client
            .default_database()
            .map(|d| d.name().to_string())
            .ok_or_else(|| "Kein Datenbankname in der URL. Wähle eine Datenbank.".to_string())
    }

    async fn sample_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<(String, String, bool)>, String> {
        let client = self.client().await?;
        let coll = client.database(schema).collection::<Document>(table);
        let pipeline = vec![
            doc! { "$limit": FIELD_SAMPLE as i64 },
            doc! { "$project": { "f": { "$objectToArray": "$$ROOT" } } },
            doc! { "$unwind": "$f" },
            doc! { "$group": { "_id": { "k": "$f.k", "t": { "$type": "$f.v" } }, "n": { "$sum": 1 } } },
            doc! { "$sort": { "n": -1, "_id.t": 1 } },
            doc! { "$group": { "_id": "$_id.k", "types": { "$push": "$_id.t" } } },
        ];
        let mut cursor = timed(async { coll.aggregate(pipeline).await.map_err(map_err) }).await?;
        let mut columns: Vec<(String, String, bool)> = Vec::new();
        while let Some(field) = cursor.try_next().await.map_err(map_err)? {
            let name = field.get_str("_id").unwrap_or_default().to_string();
            let types: Vec<String> = field
                .get_array("types")
                .map(|types| {
                    types
                        .iter()
                        .filter_map(Bson::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let nullable = name != "_id";
            columns.push((name, field_type(&types), nullable));
        }
        columns.sort_by_key(|(name, _, _)| {
            if name == "_id" {
                String::new()
            } else {
                name.clone()
            }
        });
        Ok(columns)
    }

    async fn collection_names(&self, db: &str, kind: Option<&str>) -> Result<Vec<String>, String> {
        let client = self.client().await?;
        let database = client.database(db);
        let mut names = timed(async {
            match kind {
                Some(kind) => database
                    .list_collection_names()
                    .filter(doc! { "type": kind })
                    .await
                    .map_err(map_err),
                None => database.list_collection_names().await.map_err(map_err),
            }
        })
        .await?;
        names.retain(|n| !n.starts_with("system."));
        names.sort();
        Ok(names)
    }
}

fn field_type(types: &[String]) -> String {
    let named: Vec<&str> = types
        .iter()
        .map(String::as_str)
        .filter(|ty| *ty != "null")
        .collect();
    if named.is_empty() {
        "null".into()
    } else {
        named.join(", ")
    }
}

#[async_trait]
impl DatabaseAdapter for MongoAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database("admin")
                .run_command(doc! { "ping": 1 })
                .await
                .map_err(map_err)
                .map(|_| ())
        })
        .await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let client = self.client().await?;
        timed(async { client.list_database_names().await.map_err(map_err) }).await
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let client = self.client().await?;
        Ok(vec![self.database_name(&client).await?])
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let client = self.client().await?;
        let db = match schema {
            Some(s) => s.to_string(),
            None => self.database_name(&client).await?,
        };
        Ok(self
            .collection_names(&db, None)
            .await?
            .into_iter()
            .map(|name| TableInfo {
                schema: db.clone(),
                name,
            })
            .collect())
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let db = match schema {
            Some(s) => s.to_string(),
            None => self.database_name(&self.client().await?).await?,
        };
        Ok(self
            .collection_names(&db, Some("view"))
            .await?
            .into_iter()
            .map(|name| TableInfo {
                schema: db.clone(),
                name,
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            return Ok(vec![]);
        }
        let tables = match table {
            Some(t) => vec![TableInfo {
                schema: match schema {
                    Some(schema) => schema.to_string(),
                    None => self.database_name(&self.client().await?).await?,
                },
                name: t.to_string(),
            }],
            None => self.list_tables(schema).await?,
        };
        let mut out = Vec::new();
        for t in tables {
            for (name, data_type, _) in self.sample_columns(&t.schema, &t.name).await? {
                out.push(ColumnInfo {
                    schema: t.schema.clone(),
                    table: t.name.clone(),
                    name,
                    data_type,
                });
            }
        }
        Ok(out)
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        Ok(self
            .sample_columns(schema, table)
            .await?
            .into_iter()
            .enumerate()
            .map(|(i, (name, data_type, nullable))| DetailedColumnInfo {
                is_primary_key: name == "_id",
                name,
                data_type,
                is_nullable: nullable,
                column_default: None,
                ordinal_position: i as i32 + 1,
                character_maximum_length: None,
                comment: None,
            })
            .collect())
    }

    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        _allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let client = self.client().await?;
        let query = parse_document(filter.unwrap_or(""), "Der Filter")?;
        let coll = client.database(schema).collection::<Document>(table);
        if limit <= 0 {
            return Ok(TableData {
                columns: self
                    .sample_columns(schema, table)
                    .await?
                    .into_iter()
                    .map(|(name, _, _)| name)
                    .collect(),
                rows: vec![],
            });
        }
        let mut find = coll
            .find(query)
            .skip(offset.max(0) as u64)
            .limit(limit.max(0));
        if let Some(field) = order_by {
            find = find.sort(doc! { field: if order_desc { -1 } else { 1 } });
        }
        let mut cursor = timed(async { find.await.map_err(map_err) }).await?;
        let mut documents: Vec<serde_json::Value> = Vec::new();
        let mut columns: Vec<String> = vec!["_id".to_string()];
        while let Some(document) = cursor.try_next().await.map_err(map_err)? {
            for key in document.keys() {
                if !columns.contains(key) {
                    columns.push(key.clone());
                }
            }
            documents.push(to_json(Bson::Document(document)));
        }
        if documents.is_empty() {
            columns = self
                .sample_columns(schema, table)
                .await?
                .into_iter()
                .map(|(n, _, _)| n)
                .collect();
            if columns.is_empty() {
                columns.push("_id".to_string());
            }
        }
        Ok(TableData {
            columns,
            rows: documents,
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        _allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let client = self.client().await?;
        let coll = client.database(schema).collection::<Document>(table);
        let query = parse_document(filter.unwrap_or(""), "Der Filter")?;
        timed(async {
            if query.is_empty() {
                coll.estimated_document_count()
                    .await
                    .map(|n| n as i64)
                    .map_err(map_err)
            } else {
                coll.count_documents(query)
                    .await
                    .map(|n| n as i64)
                    .map_err(map_err)
            }
        })
        .await
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let client = self.client().await?;
        let start = std::time::Instant::now();
        let command = match super::mongo_shell::to_command(sql) {
            Some(command) => command?,
            None => parse_document(sql, "Der Befehl")?,
        };
        if command.is_empty() {
            return Err("Gib ein MongoDB-Befehlsdokument ein, z. B. {\"find\": \"users\", \"filter\": {}} oder {\"aggregate\": \"orders\", \"pipeline\": [], \"cursor\": {}}".to_string());
        }
        let db = self.database_name(&client).await?;
        let mut command = command;
        if command.contains_key("aggregate") && !command.contains_key("cursor") {
            command.insert("cursor", doc! {});
        }
        let cursor_command = command.keys().next().is_some_and(|name| {
            matches!(
                name.as_str(),
                "find" | "aggregate" | "listCollections" | "listIndexes"
            )
        });
        let mut truncated = false;
        let (result, batch) = if cursor_command {
            let (items, capped) = timed(async {
                let cursor = client
                    .database(&db)
                    .run_cursor_command(command)
                    .await
                    .map_err(map_err)?;
                collect_capped(cursor, super::commands::MAX_RESULT_ROWS)
                    .await
                    .map_err(map_err)
            })
            .await?;
            truncated = capped;
            (
                Document::new(),
                Some(items.into_iter().map(Bson::Document).collect::<Vec<_>>()),
            )
        } else {
            let result = timed(async {
                client
                    .database(&db)
                    .run_command(command)
                    .await
                    .map_err(map_err)
            })
            .await?;
            if let Ok(errors) = result.get_array("writeErrors") {
                if !errors.is_empty() {
                    return Err(write_error(errors));
                }
            }
            if let Ok(error) = result.get_document("writeConcernError") {
                return Err(write_error(&[Bson::Document(error.clone())]));
            }
            let batch = result.get_array("documents").ok().cloned();
            (result, batch)
        };
        let (columns, rows) = match batch {
            Some(items) => {
                let mut columns: Vec<String> = Vec::new();
                let rows: Vec<serde_json::Value> = items
                    .into_iter()
                    .map(|item| {
                        if let Bson::Document(d) = &item {
                            for key in d.keys() {
                                if !columns.contains(key) {
                                    columns.push(key.clone());
                                }
                            }
                        }
                        to_json(item)
                    })
                    .collect();
                (columns, rows)
            }
            None => {
                let columns: Vec<String> = result.keys().cloned().collect();
                (columns, vec![to_json(Bson::Document(result))])
            }
        };
        let affected = (!cursor_command)
            .then(|| rows.first())
            .flatten()
            .and_then(|r| r.get("n"))
            .and_then(|n| n.as_u64());
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: affected,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated,
        })
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database(schema)
                .collection::<Document>(table)
                .drop()
                .await
                .map_err(map_err)
        })
        .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database(schema)
                .collection::<Document>(table)
                .delete_many(doc! {})
                .await
                .map_err(map_err)
                .map(|_| ())
        })
        .await
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database(&req.schema)
                .create_collection(&req.name)
                .await
                .map_err(map_err)
        })
        .await
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let client = self.client().await?;
        let mut cursor = timed(async {
            client
                .database(schema)
                .collection::<Document>(table)
                .list_indexes()
                .await
                .map_err(map_err)
        })
        .await?;
        let mut out = Vec::new();
        while let Some(index) = cursor.try_next().await.map_err(map_err)? {
            let name = index
                .options
                .as_ref()
                .and_then(|o| o.name.clone())
                .unwrap_or_default();
            let columns: Vec<String> = index
                .keys
                .iter()
                .map(|(k, v)| format!("{k} {}", to_json(v.clone())))
                .collect();
            out.push(IndexInfo {
                is_primary: name == "_id_",
                is_unique: index
                    .options
                    .as_ref()
                    .and_then(|o| o.unique)
                    .unwrap_or(false)
                    || name == "_id_",
                index_type: index
                    .keys
                    .values()
                    .find_map(Bson::as_str)
                    .unwrap_or("btree")
                    .to_string(),
                definition: to_json(Bson::Document(index.keys.clone())).to_string(),
                columns,
                name,
            })
        }
        Ok(out)
    }

    async fn list_import_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<super::ImportColumnInfo>, String> {
        Ok(self
            .sample_columns(schema, table)
            .await?
            .into_iter()
            .enumerate()
            .map(|(i, (name, data_type, _))| super::ImportColumnInfo {
                has_default: name == "_id",
                name,
                data_type,
                is_nullable: true,
                is_identity: false,
                is_generated: false,
                ordinal_position: i as i32 + 1,
            })
            .collect())
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<super::ConstraintInfo>, String> {
        Ok(self
            .list_indexes(schema, table)
            .await?
            .into_iter()
            .filter(|index| index.is_unique)
            .map(|index| super::ConstraintInfo {
                constraint_type: if index.is_primary {
                    "PRIMARY KEY".into()
                } else {
                    "UNIQUE".into()
                },
                columns: index
                    .columns
                    .iter()
                    .filter_map(|column| column.rsplit_once(' ').map(|(name, _)| name.to_string()))
                    .collect(),
                definition: index.definition,
                name: index.name,
            })
            .collect())
    }

    async fn csv_import(
        &self,
        request: &super::CsvImportRequest,
    ) -> Result<super::CsvImportOutcome, String> {
        super::import::validate_request(request)?;
        let client = self.client().await?;
        let collection = client
            .database(&request.schema)
            .collection::<Document>(&request.table);
        let conflict = match &request.conflict {
            Some(conflict) => {
                let keys = self
                    .list_constraints(&request.schema, &request.table)
                    .await?
                    .into_iter()
                    .find(|constraint| constraint.name == conflict.constraint)
                    .map(|constraint| constraint.columns)
                    .ok_or("Konfliktziel muss ein eindeutiger Index sein.")?;
                if keys.is_empty() || keys.iter().any(|key| !request.columns.contains(key)) {
                    return Err("Alle Konfliktschlüssel müssen zugeordnet sein.".into());
                }
                Some((keys, conflict.update_columns.clone()))
            }
            None => None,
        };
        let rows: super::import_source::RowStream = match &request.file {
            Some(source) => super::import_source::open_rows(source)?,
            None => Box::new(request.rows.clone().into_iter().map(Ok)),
        };
        let mut counts = super::import::Counts::default();
        let mut batch: Vec<Document> = Vec::new();
        let mut processed = 0usize;
        let mut failure: Option<(Option<u32>, String)> = None;
        let mut iterator = rows.enumerate();
        loop {
            let next = iterator.next();
            if let Some((index, row)) = &next {
                match row {
                    Ok(row) => {
                        batch.push(import_document(&request.columns, row));
                        processed = index + 1;
                    }
                    Err(error) => {
                        failure = Some((Some(*index as u32 + 1), error.clone()));
                    }
                }
            }
            let full = batch.len() >= 1000;
            if failure.is_none() && !batch.is_empty() && (full || next.is_none()) {
                if super::execution::cancellation_token().is_cancelled() {
                    failure = Some((None, "Import vom Benutzer abgebrochen.".into()));
                } else {
                    let start = processed - batch.len();
                    let documents = std::mem::take(&mut batch);
                    if let Err(error) =
                        write_documents(&collection, documents, conflict.as_ref(), &mut counts)
                            .await
                    {
                        failure = Some((Some(start as u32 + 1), error));
                    }
                    super::execution::progress(processed as u64);
                }
            }
            if failure.is_some() || next.is_none() {
                break;
            }
        }
        Ok(super::CsvImportOutcome {
            inserted_rows: counts.inserted,
            updated_rows: counts.updated,
            skipped_rows: counts.skipped,
            failed_row: failure.as_ref().and_then(|(row, _)| *row),
            failed_column: None,
            error: failure.map(|(_, message)| {
                format!(
                    "{message} Keine Transaktion: {} bereits geschriebene Dokument(e) bleiben erhalten.",
                    counts.inserted + counts.updated
                )
            }),
        })
    }

    async fn export_table_csv(
        &self,
        request: &super::export::TableExportRequest,
        progress: &(dyn Fn(i64) + Send + Sync),
    ) -> Result<super::export::TableExportOutcome, String> {
        use super::export;
        use super::export_formats::{FileFormat, RowSink, SinkSpec};
        if request.format == FileFormat::Csv {
            export::validate_csv_options(&request.options)?;
        }
        let filter = parse_document(request.filter.as_deref().unwrap_or(""), "Der Filter")?;
        let columns: Vec<String> = self
            .sample_columns(&request.schema, &request.table)
            .await?
            .into_iter()
            .map(|(name, _, _)| name)
            .collect();
        if columns.is_empty() {
            return Err("Keine Felder für den Export gefunden.".into());
        }
        let max_rows = export::effective_max_rows(request.max_rows);
        let client = self.client().await?;
        let coll = client
            .database(&request.schema)
            .collection::<Document>(&request.table);
        let mut find = coll
            .find(filter)
            .limit(max_rows.saturating_add(1))
            .batch_size(export::EXPORT_BATCH_ROWS as u32);
        if let Some(field) = request.order_by.as_deref() {
            find = find.sort(doc! { field: if request.order_desc { -1 } else { 1 } });
        }
        let mut cursor = timed(async { find.await.map_err(map_err) }).await?;
        let mut writer = RowSink::create(SinkSpec {
            format: request.format,
            path: &request.path,
            columns: &columns,
            kinds: super::export_formats::parquet_kinds(&columns, &[], &[], &request.masks),
            csv: Some(&request.options),
            title: Some(&request.table),
        })?;
        let shuffle_seed = std::hash::BuildHasher::hash_one(
            &std::collections::hash_map::RandomState::new(),
            &request.job_id,
        );
        let (mut total, mut truncated) = (0i64, false);
        let mut batch: Vec<serde_json::Value> = Vec::new();
        let mut failure: Option<String> = None;
        loop {
            let next = if export::is_cancelled(&request.job_id) {
                None
            } else {
                match cursor.try_next().await {
                    Ok(next) => next,
                    Err(error) => {
                        failure = Some(map_err(error));
                        None
                    }
                }
            };
            if next.is_some() && total + batch.len() as i64 == max_rows {
                truncated = true;
            }
            let done = next.is_none() || truncated;
            if let Some(document) = next.filter(|_| !truncated) {
                batch.push(to_json(Bson::Document(document)));
            }
            if failure.is_none() && (done || batch.len() as i64 >= export::EXPORT_BATCH_ROWS) {
                for mask in request
                    .masks
                    .iter()
                    .filter(|mask| mask.mode == super::masking::MaskMode::Shuffle)
                {
                    super::masking::shuffle_column(
                        &mut batch,
                        &mask.column,
                        shuffle_seed ^ total as u64,
                    );
                }
                for value in batch.drain(..) {
                    if let Err(error) =
                        writer.write_row(&columns, &value, &request.masks, Some(&request.options))
                    {
                        failure = Some(error);
                        break;
                    }
                    total += 1;
                }
                progress(total);
            }
            if done || failure.is_some() {
                break;
            }
        }
        if export::is_cancelled(&request.job_id) {
            writer.abort();
            export::clear_cancel(&request.job_id);
            return Err("Export abgebrochen.".to_string());
        }
        if let Some(message) = failure {
            writer.abort();
            return Err(message);
        }
        writer.finish()?;
        Ok(export::TableExportOutcome {
            rows: total,
            path: request.path.clone(),
            truncated,
        })
    }

    async fn create_schema(&self, _name: &str) -> Result<(), String> {
        Err(unsupported(
            "Datenbanken werden bei der ersten Collection automatisch angelegt",
        ))
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        let client = self.client().await?;
        timed(async { client.database(name).drop().await.map_err(map_err) }).await
    }
}

pub(crate) fn import_value(key: &str, text: &str) -> Bson {
    let trimmed = text.trim();
    if key == "_id" && trimmed.len() == 24 {
        if let Ok(id) = mongodb::bson::oid::ObjectId::parse_str(trimmed) {
            return Bson::ObjectId(id);
        }
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Ok(bson) = Bson::try_from(value) {
                return bson;
            }
        }
    }
    match trimmed {
        "true" => return Bson::Boolean(true),
        "false" => return Bson::Boolean(false),
        _ => {}
    }
    let numeric = !trimmed.is_empty()
        && trimmed == text
        && serde_json::from_str::<serde_json::Number>(trimmed).is_ok();
    if numeric {
        if let Ok(value) = trimmed.parse::<i64>() {
            return i32::try_from(value)
                .map(Bson::Int32)
                .unwrap_or(Bson::Int64(value));
        }
        if let Ok(value) = trimmed.parse::<f64>() {
            return Bson::Double(value);
        }
    }
    Bson::String(text.to_string())
}

fn import_document(columns: &[String], row: &[Option<String>]) -> Document {
    let mut document = Document::new();
    for (column, value) in columns.iter().zip(row) {
        if let Some(value) = value {
            document.insert(column.clone(), import_value(column, value));
        }
    }
    document
}

async fn write_documents(
    collection: &mongodb::Collection<Document>,
    documents: Vec<Document>,
    conflict: Option<&(Vec<String>, Vec<String>)>,
    counts: &mut super::import::Counts,
) -> Result<(), String> {
    let Some((keys, updates)) = conflict else {
        let total = documents.len() as u64;
        timed(async { collection.insert_many(documents).await.map_err(map_err) }).await?;
        counts.inserted += total;
        return Ok(());
    };
    for document in documents {
        let mut filter = Document::new();
        for key in keys {
            filter.insert(
                key.clone(),
                document.get(key).cloned().unwrap_or(Bson::Null),
            );
        }
        let mut set = Document::new();
        let mut on_insert = Document::new();
        for (key, value) in document {
            if updates.contains(&key) {
                set.insert(key, value);
            } else if !keys.contains(&key) {
                on_insert.insert(key, value);
            }
        }
        let mut update = doc! {};
        if !set.is_empty() {
            update.insert("$set", set);
        }
        if !on_insert.is_empty() {
            update.insert("$setOnInsert", on_insert);
        }
        if update.is_empty() {
            update.insert("$setOnInsert", filter.clone());
        }
        let result = timed(async {
            collection
                .update_one(filter, update)
                .upsert(true)
                .await
                .map_err(map_err)
        })
        .await?;
        if result.upserted_id.is_some() {
            counts.inserted += 1;
        } else if !updates.is_empty() {
            counts.updated += 1;
        } else {
            counts.skipped += 1;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cursor_results_stop_after_the_row_cap() {
        use futures_util::StreamExt;
        let pulled = std::sync::atomic::AtomicUsize::new(0);
        let stream = futures_util::stream::iter(0..1_000_000usize).map(|value| {
            pulled.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok::<_, String>(value)
        });
        let (items, truncated) = collect_capped(stream, 1000).await.unwrap();
        assert!(truncated);
        assert_eq!(items.len(), 1000);
        assert_eq!(items.last(), Some(&999));
        assert_eq!(pulled.load(std::sync::atomic::Ordering::Relaxed), 1001);

        let (items, truncated) = collect_capped(
            futures_util::stream::iter((0..1000).map(Ok::<_, String>)),
            1000,
        )
        .await
        .unwrap();
        assert!(!truncated);
        assert_eq!(items.len(), 1000);

        let (items, truncated) = collect_capped(
            futures_util::stream::iter((0..3).map(Ok::<_, String>)),
            1000,
        )
        .await
        .unwrap();
        assert!(!truncated);
        assert_eq!(items, vec![0, 1, 2]);

        let failing = futures_util::stream::iter(vec![Ok(1), Err("boom".to_string())]);
        assert_eq!(collect_capped(failing, 1000).await, Err("boom".to_string()));
    }

    #[test]
    fn import_values_are_typed() {
        assert_eq!(import_value("n", "42"), Bson::Int32(42));
        assert_eq!(import_value("n", "9999999999"), Bson::Int64(9_999_999_999));
        assert_eq!(import_value("n", "1.5"), Bson::Double(1.5));
        assert_eq!(import_value("n", "01234"), Bson::String("01234".into()));
        assert_eq!(import_value("n", " 7"), Bson::String(" 7".into()));
        assert_eq!(import_value("b", "true"), Bson::Boolean(true));
        assert!(matches!(
            import_value("_id", "65a1b2c3d4e5f60718293a4b"),
            Bson::ObjectId(_)
        ));
        assert!(matches!(
            import_value("o", "{\"a\": [1]}"),
            Bson::Document(_)
        ));
        let document = import_document(&["a".into(), "b".into()], &[Some("x".into()), None]);
        assert_eq!(document, doc! { "a": "x" });
    }

    #[test]
    fn parses_filters() {
        assert!(parse_document("", "x").unwrap().is_empty());
        assert_eq!(
            parse_document("{\"a\": 1}", "x")
                .unwrap()
                .get_i32("a")
                .unwrap(),
            1
        );
        assert!(parse_document("a = 1", "x").is_err());
        assert!(MongoAdapter::new(
            "mysql://x",
            None,
            crate::db::pool::create_pool_state(),
            "k".into()
        )
        .is_err());
        assert!(MongoAdapter::new(
            "mongodb+srv://cs-admin:XXX@cXXX.mongodb.net/",
            None,
            crate::db::pool::create_pool_state(),
            "srv".into()
        )
        .is_ok());
    }

    #[test]
    fn errors_are_plain_german_text() {
        assert_eq!(
            server_error(2, "BadValue", "error processing query: ns=x planner returned error :: caused by :: hint provided does not correspond to an existing index"),
            "Der Index aus hint() existiert nicht. Indexnamen mit getIndexes() prüfen. (Code 2, BadValue: hint provided does not correspond to an existing index)"
        );
        assert!(server_error(
            20,
            "IllegalOperation",
            "renameCollection may only be run against the admin database."
        )
        .starts_with("Vom Server abgelehnt"));
        assert!(server_error(
            13,
            "Unauthorized",
            "renameCollection may only be run against the admin database."
        )
        .starts_with("Nur in der Datenbank „admin“"));
        assert!(server_error(
            13,
            "Unauthorized",
            "Command listDatabases requires authentication"
        )
        .starts_with("Anmeldung nötig"));
        assert!(
            server_error(18, "AuthenticationFailed", "Authentication failed.")
                .contains("authSource")
        );
        let refused = unreachable_error("Server selection timeout: No available servers. Topology: { Type: Unknown, Servers: [ { Address: 127.0.0.1:27066, Type: Unknown, Error: Kind: I/O error: Connection refused (os error 61), labels: {} } ] }");
        assert_eq!(
            refused,
            "Server 127.0.0.1:27066 nicht erreichbar: Verbindung abgelehnt."
        );
        let write = write_error(&[
            Bson::Document(
                doc! { "index": 0, "code": 11000, "errmsg": "E11000 duplicate key error" },
            ),
            Bson::Document(
                doc! { "index": 1, "code": 11000, "errmsg": "E11000 duplicate key error" },
            ),
        ]);
        assert_eq!(
            write,
            "MongoDB: Wert verletzt einen eindeutigen Index: E11000 duplicate key error (Code 11000) (+1 weitere Schreibfehler)"
        );
        let filter = parse_document("status = 'open'", "Der Filter").unwrap_err();
        assert!(filter.starts_with("Der Filter muss gültiges JSON sein (Zeile 1, Spalte 1)"));
        assert!(filter.contains("SQL-Bedingungen gelten bei MongoDB nicht"));
        let open = parse_document("{\"status\":\"open\"", "Der Filter").unwrap_err();
        assert!(open.contains("unvollständig"));
        assert!(!open.contains("SQL"));
        for text in [&filter, &open] {
            assert!(
                !text.contains("expected") && !text.contains("EOF"),
                "{text}"
            );
        }
    }

    #[test]
    fn shell_text_reads_like_mongosh() {
        let row = to_json(Bson::Document(doc! {
            "oid": mongodb::bson::oid::ObjectId::parse_str("65a1b2c3d4e5f60718293a4b").unwrap(),
            "big": 9_007_199_254_740_993i64,
            "old": mongodb::bson::DateTime::parse_rfc3339_str("1950-06-15T12:00:00Z").unwrap(),
            "dec": mongodb::bson::Decimal128::from_bytes([0; 16]),
            "uuid": mongodb::bson::Binary::from_uuid(mongodb::bson::Uuid::parse_str("c9a646d3-9c61-4cb3-b9e1-3f2e0b3e5a10").unwrap()),
            "ts": mongodb::bson::Timestamp { time: 1_700_000_000, increment: 1 },
            "nested": { "id": mongodb::bson::oid::ObjectId::parse_str("65a1b2c3d4e5f60718293a4b").unwrap(), "n": 1 },
            "name": "x",
            "nothing": Bson::Null,
        }));
        assert_eq!(row["old"]["$date"], "1950-06-15T12:00:00Z");
        assert_eq!(
            parse_document(&row.to_string(), "x")
                .unwrap()
                .get_datetime("old")
                .unwrap()
                .timestamp_millis(),
            -616_852_800_000
        );
        let shell = &shell_rows(&[row])[0];
        assert_eq!(shell["oid"], "ObjectId(\"65a1b2c3d4e5f60718293a4b\")");
        assert_eq!(shell["big"], "NumberLong(\"9007199254740993\")");
        assert_eq!(shell["old"], "ISODate(\"1950-06-15T12:00:00Z\")");
        assert!(shell["dec"].as_str().unwrap().starts_with("NumberDecimal("));
        assert_eq!(
            shell["uuid"],
            "UUID(\"c9a646d3-9c61-4cb3-b9e1-3f2e0b3e5a10\")"
        );
        assert_eq!(shell["ts"], "Timestamp(1700000000, 1)");
        assert_eq!(
            shell["nested"],
            "{ id: ObjectId(\"65a1b2c3d4e5f60718293a4b\"), n: 1 }"
        );
        assert_eq!(shell["name"], "x");
        assert!(shell["nothing"].is_null());
    }

    #[test]
    fn field_types_list_every_type_but_null() {
        let types =
            |items: &[&str]| field_type(&items.iter().map(|t| t.to_string()).collect::<Vec<_>>());
        assert_eq!(types(&["int", "null", "string"]), "int, string");
        assert_eq!(types(&["null"]), "null");
        assert_eq!(types(&["date"]), "date");
    }

    #[test]
    fn extended_json_is_relaxed() {
        let json = to_json(Bson::Document(
            doc! { "n": 1i64, "t": mongodb::bson::DateTime::from_millis(0) },
        ));
        assert_eq!(json["n"], 1);
        assert_eq!(json["t"]["$date"], "1970-01-01T00:00:00Z");
    }
}

#[cfg(test)]
#[path = "mongodb_tests.rs"]
mod integration_tests;

#[cfg(test)]
#[path = "mongodb_browser_tests.rs"]
mod browser_tests;
