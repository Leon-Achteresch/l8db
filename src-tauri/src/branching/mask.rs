use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::crypto;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    Keep,
    Redact,
    Null,
    Hash,
    Email,
    Name,
    Phone,
    Partial,
    Ip,
    Zero,
    YearOnly,
    Uuid,
    EmptyJson,
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskRule {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub strategy: Strategy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Text,
    Number,
    Date,
    Timestamp,
    Json,
    Uuid,
    Bytea,
    Inet,
    Bool,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pii {
    pub reason: String,
    pub strategy: Option<Strategy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub data_type: String,
    pub category: Category,
    pub max_length: Option<usize>,
    pub not_null: bool,
    pub generated: bool,
    pub root_schema: String,
    pub root_table: String,
    pub pii: Option<Pii>,
}

pub fn category(base_type: &str) -> Category {
    let name = base_type.trim().to_ascii_lowercase();
    if name.ends_with("[]") {
        return Category::Other;
    }
    let head = name.split('(').next().unwrap_or("").trim();
    match head {
        "text" | "character varying" | "varchar" | "character" | "char" | "bpchar" | "name"
        | "citext" => Category::Text,
        "smallint" | "integer" | "bigint" | "numeric" | "decimal" | "real" | "double precision"
        | "money" => Category::Number,
        "date" => Category::Date,
        "json" | "jsonb" => Category::Json,
        "uuid" => Category::Uuid,
        "bytea" => Category::Bytea,
        "inet" | "cidr" => Category::Inet,
        "boolean" => Category::Bool,
        other if other.starts_with("timestamp") => Category::Timestamp,
        _ => Category::Other,
    }
}

fn tokens(name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut previous_lower = false;
    for ch in name.chars() {
        if !ch.is_alphanumeric() {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            previous_lower = false;
            continue;
        }
        if ch.is_uppercase() && previous_lower && !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
        previous_lower = ch.is_lowercase() || ch.is_ascii_digit();
        current.extend(ch.to_lowercase());
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

pub fn detect(name: &str, category: Category, not_null: bool) -> Option<Pii> {
    let parts = tokens(name);
    let joined = parts.concat();
    let has = |words: &[&str]| {
        parts.iter().any(|part| words.contains(&part.as_str())) || words.contains(&joined.as_str())
    };
    let pair = |a: &[&str], b: &[&str]| has(a) && has(b);
    let found = |reason: &str, strategy: Strategy| {
        let fits = compatible(strategy, category, not_null);
        Some(Pii {
            reason: reason.into(),
            strategy: if fits {
                Some(strategy)
            } else if !not_null {
                Some(Strategy::Null)
            } else {
                None
            },
        })
    };
    let secret = [
        "password",
        "passwort",
        "passwd",
        "pwd",
        "secret",
        "token",
        "apikey",
        "salt",
        "otp",
        "totp",
        "privatekey",
        "pin",
        "credential",
        "credentials",
    ];
    if has(&secret)
        || pair(
            &["api", "private", "access", "refresh", "auth", "session"],
            &["key", "token"],
        )
    {
        return found("Geheimnis oder Zugangsdaten", Strategy::Redact);
    }
    if has(&["email", "mail", "emailaddress"]) || joined.contains("email") {
        return found("E-Mail-Adresse", Strategy::Email);
    }
    if has(&[
        "phone",
        "telefon",
        "telephone",
        "tel",
        "mobile",
        "mobil",
        "handy",
        "fax",
        "cell",
        "telefonnummer",
        "phonenumber",
    ]) {
        return found("Telefonnummer", Strategy::Phone);
    }
    if has(&[
        "iban",
        "bic",
        "swift",
        "kontonummer",
        "blz",
        "accountnumber",
        "bankaccount",
    ]) || pair(&["account", "konto"], &["number", "nummer", "no"])
    {
        return found("Bankverbindung", Strategy::Hash);
    }
    if has(&["creditcard", "cardnumber", "ccnumber", "cvv", "cvc", "pan"])
        || pair(&["card", "credit"], &["number", "card"])
    {
        return found("Kartendaten", Strategy::Redact);
    }
    if has(&[
        "ssn",
        "taxid",
        "steuerid",
        "steuernummer",
        "vatid",
        "ustid",
        "passport",
        "reisepass",
        "personalausweis",
        "idcard",
        "nationalid",
        "svnr",
        "sozialversicherungsnummer",
        "versicherungsnummer",
    ]) || pair(&["social"], &["security"])
        || pair(&["tax", "national", "steuer"], &["id", "number", "nummer"])
    {
        return found("Ausweis- oder Steuernummer", Strategy::Hash);
    }
    if has(&[
        "birthday",
        "birthdate",
        "dob",
        "geburtstag",
        "geburtsdatum",
        "birth",
        "geburt",
        "born",
    ]) {
        return found(
            "Geburtsdatum",
            if matches!(category, Category::Date | Category::Timestamp) {
                Strategy::YearOnly
            } else {
                Strategy::Redact
            },
        );
    }
    if has(&[
        "username",
        "benutzername",
        "login",
        "nickname",
        "displayname",
    ]) || pair(&["user", "display"], &["name"])
    {
        return found("Benutzerkennung", Strategy::Hash);
    }
    if has(&[
        "firstname",
        "lastname",
        "surname",
        "vorname",
        "nachname",
        "fullname",
        "givenname",
        "familyname",
    ]) || pair(
        &[
            "first",
            "last",
            "full",
            "given",
            "family",
            "customer",
            "contact",
            "person",
            "employee",
            "patient",
            "client",
            "kunde",
            "kunden",
            "owner",
            "author",
            "recipient",
            "sender",
        ],
        &["name"],
    ) {
        return found("Personenname", Strategy::Name);
    }
    if has(&[
        "street",
        "strasse",
        "straße",
        "address",
        "adresse",
        "addr",
        "addressline",
        "hausnummer",
        "housenumber",
    ]) {
        return found("Anschrift", Strategy::Redact);
    }
    if has(&[
        "zip",
        "zipcode",
        "postal",
        "postcode",
        "plz",
        "postleitzahl",
    ]) {
        return found("Postleitzahl", Strategy::Redact);
    }
    if has(&["ip", "ipaddress", "ipaddr", "remoteaddr", "clientip"]) || category == Category::Inet {
        return found("IP-Adresse", Strategy::Ip);
    }
    if has(&[
        "latitude",
        "longitude",
        "lat",
        "lng",
        "geolocation",
        "coordinates",
    ]) {
        return found(
            "Standort",
            if category == Category::Number {
                Strategy::Zero
            } else {
                Strategy::Redact
            },
        );
    }
    None
}

pub fn compatible(strategy: Strategy, category: Category, not_null: bool) -> bool {
    match strategy {
        Strategy::Keep | Strategy::Fixed => true,
        Strategy::Null => !not_null,
        Strategy::Redact
        | Strategy::Hash
        | Strategy::Email
        | Strategy::Name
        | Strategy::Phone
        | Strategy::Partial => category == Category::Text,
        Strategy::Ip => matches!(category, Category::Text | Category::Inet),
        Strategy::Zero => category == Category::Number,
        Strategy::YearOnly => matches!(category, Category::Date | Category::Timestamp),
        Strategy::Uuid => category == Category::Uuid,
        Strategy::EmptyJson => category == Category::Json,
    }
}

#[derive(Debug, Clone)]
struct Plan {
    strategy: Strategy,
    value: Option<String>,
    category: Category,
    max_length: Option<usize>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub tables: u64,
    pub masked_tables: u64,
    pub rows: u64,
    pub values: u64,
}

enum State {
    Sql,
    Copy(Option<Vec<Option<Plan>>>),
}

type TableKey = (String, String);

pub struct Masker {
    plans: HashMap<TableKey, HashMap<String, Plan>>,
    roots: HashMap<TableKey, TableKey>,
    key: crypto::Secret,
    state: State,
    pending: Vec<u8>,
    restricted: bool,
    pub stats: Stats,
}

fn table_key(schema: &str, table: &str) -> TableKey {
    (schema.to_string(), table.to_string())
}

pub fn validate(rules: &[MaskRule], columns: &[Column]) -> Result<(), String> {
    let index: HashMap<(&str, &str, &str), &Column> = columns
        .iter()
        .map(|column| {
            (
                (
                    column.schema.as_str(),
                    column.table.as_str(),
                    column.column.as_str(),
                ),
                column,
            )
        })
        .collect();
    let mut seen = HashSet::new();
    for rule in rules {
        let label = format!("{}.{}.{}", rule.schema, rule.table, rule.column);
        if !seen.insert((&rule.schema, &rule.table, &rule.column)) {
            return Err(format!("Doppelte Maskierungsregel für {label}."));
        }
        let column = index
            .get(&(
                rule.schema.as_str(),
                rule.table.as_str(),
                rule.column.as_str(),
            ))
            .ok_or_else(|| format!("Maskierungsregel verweist auf unbekannte Spalte {label}."))?;
        if column.generated {
            return Err(format!(
                "{label} ist eine berechnete Spalte und wird nicht übertragen."
            ));
        }
        if !compatible(rule.strategy, column.category, column.not_null) {
            return Err(format!(
                "Die Maskierung „{:?}“ passt nicht zu {label} ({}{}).",
                rule.strategy,
                column.data_type,
                if column.not_null { ", NOT NULL" } else { "" }
            ));
        }
        if rule.strategy == Strategy::Fixed
            && rule
                .value
                .as_deref()
                .is_none_or(|value| value.contains('\0'))
        {
            return Err(format!("Für {label} fehlt ein fester Ersatzwert."));
        }
    }
    Ok(())
}

pub fn uncovered(rules: &[MaskRule], columns: &[Column]) -> Vec<String> {
    let covered: HashSet<(&str, &str, &str)> = rules
        .iter()
        .map(|rule| {
            (
                rule.schema.as_str(),
                rule.table.as_str(),
                rule.column.as_str(),
            )
        })
        .collect();
    columns
        .iter()
        .filter(|column| column.pii.is_some() && !column.generated)
        .filter(|column| column.schema == column.root_schema && column.table == column.root_table)
        .filter(|column| {
            !covered.contains(&(
                column.schema.as_str(),
                column.table.as_str(),
                column.column.as_str(),
            ))
        })
        .map(|column| format!("{}.{}.{}", column.schema, column.table, column.column))
        .collect()
}

impl Masker {
    pub fn new(
        rules: &[MaskRule],
        columns: &[Column],
        key: crypto::Secret,
    ) -> Result<Self, String> {
        validate(rules, columns)?;
        let missing = uncovered(rules, columns);
        if !missing.is_empty() {
            return Err(format!(
                "Personenbezogene Spalten ohne Regel: {}. Regel festlegen oder ausdrücklich „Unverändert“ wählen.",
                missing.join(", ")
            ));
        }
        let meta: HashMap<(&str, &str, &str), &Column> = columns
            .iter()
            .map(|column| {
                (
                    (
                        column.schema.as_str(),
                        column.table.as_str(),
                        column.column.as_str(),
                    ),
                    column,
                )
            })
            .collect();
        let mut plans: HashMap<TableKey, HashMap<String, Plan>> = HashMap::new();
        for rule in rules.iter().filter(|rule| rule.strategy != Strategy::Keep) {
            let column = meta[&(
                rule.schema.as_str(),
                rule.table.as_str(),
                rule.column.as_str(),
            )];
            plans
                .entry(table_key(&rule.schema, &rule.table))
                .or_default()
                .insert(
                    rule.column.clone(),
                    Plan {
                        strategy: rule.strategy,
                        value: rule.value.clone(),
                        category: column.category,
                        max_length: column.max_length,
                    },
                );
        }
        let roots = columns
            .iter()
            .map(|column| {
                (
                    table_key(&column.schema, &column.table),
                    table_key(&column.root_schema, &column.root_table),
                )
            })
            .collect();
        Ok(Self {
            plans,
            roots,
            key,
            state: State::Sql,
            pending: Vec::new(),
            restricted: false,
            stats: Stats::default(),
        })
    }

    pub fn feed(&mut self, data: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
        self.pending.extend_from_slice(data);
        let mut start = 0;
        while let Some(offset) = self.pending[start..].iter().position(|byte| *byte == b'\n') {
            let end = start + offset;
            let line = self.pending[start..end].to_vec();
            self.line(&line, out)?;
            out.push(b'\n');
            start = end + 1;
        }
        self.pending.drain(..start);
        Ok(())
    }

    pub fn finish(&mut self, out: &mut Vec<u8>) -> Result<Stats, String> {
        if !self.pending.is_empty() {
            let line = std::mem::take(&mut self.pending);
            self.line(&line, out)?;
        }
        if !matches!(self.state, State::Sql) {
            return Err("Der Datenstrom endet innerhalb eines COPY-Blocks.".into());
        }
        Ok(self.stats.clone())
    }

    fn line(&mut self, line: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
        match &self.state {
            State::Sql => {
                if line.starts_with(b"\\restrict ") {
                    self.restricted = true;
                } else if !self.restricted && !line.is_empty() && !line.starts_with(b"--") {
                    return Err("Der SQL-Datenstrom ist nicht gegen psql-Metabefehle geschützt (\\restrict fehlt). pg_dump und psql aktualisieren.".into());
                }
                if line.starts_with(b"SELECT pg_catalog.lowrite")
                    || line.starts_with(b"SELECT pg_catalog.lo_")
                {
                    return Err(
                        "Large Objects sind in anonymisierten Branches nicht zulässig.".into(),
                    );
                }
                if line
                    .windows(26)
                    .any(|window| window == b"pg_restore_attribute_stats")
                {
                    return Err("Spaltenstatistiken können Originalwerte enthalten und sind in anonymisierten Branches nicht zulässig.".into());
                }
                if line.starts_with(b"COPY ") {
                    let (schema, table, columns) = parse_copy(line)?;
                    self.enter(&schema, &table, &columns)?;
                }
                out.extend_from_slice(line);
                Ok(())
            }
            State::Copy(plans) => {
                if line == b"\\." {
                    self.state = State::Sql;
                    out.extend_from_slice(line);
                    return Ok(());
                }
                self.stats.rows += 1;
                let Some(plans) = plans else {
                    out.extend_from_slice(line);
                    return Ok(());
                };
                let fields: Vec<&[u8]> = line.split(|byte| *byte == b'\t').collect();
                if fields.len() != plans.len() {
                    return Err(format!(
                        "Unerwartete Spaltenanzahl in Datenzeile {} ({} statt {}).",
                        self.stats.rows,
                        fields.len(),
                        plans.len()
                    ));
                }
                let mut values = 0;
                for (index, (field, plan)) in fields.iter().zip(plans.iter()).enumerate() {
                    if index > 0 {
                        out.push(b'\t');
                    }
                    match plan {
                        Some(plan) if *field != b"\\N" => {
                            values += 1;
                            match masked(plan, &unescape(field), self.key.as_ref()) {
                                Some(text) => escape_into(text.as_bytes(), out),
                                None => out.extend_from_slice(b"\\N"),
                            }
                        }
                        _ => out.extend_from_slice(field),
                    }
                }
                self.stats.values += values;
                Ok(())
            }
        }
    }

    fn enter(&mut self, schema: &str, table: &str, columns: &[String]) -> Result<(), String> {
        self.stats.tables += 1;
        if columns.is_empty() {
            self.state = State::Copy(None);
            return Ok(());
        }
        let root = self
            .roots
            .get(&table_key(schema, table))
            .cloned()
            .ok_or_else(|| {
                format!("Tabelle {schema}.{table} fehlt im geprüften Katalog; Vorgang abgebrochen.")
            })?;
        let plans = match self.plans.get(&root) {
            None => None,
            Some(rules) => {
                if let Some(missing) = rules.keys().find(|column| !columns.contains(column)) {
                    return Err(format!(
                        "Maskierte Spalte {schema}.{table}.{missing} fehlt im Datenstrom; Vorgang abgebrochen."
                    ));
                }
                self.stats.masked_tables += 1;
                Some(
                    columns
                        .iter()
                        .map(|column| rules.get(column).cloned())
                        .collect::<Vec<_>>(),
                )
            }
        };
        self.state = State::Copy(plans);
        Ok(())
    }
}

fn parse_identifier(line: &[u8], index: &mut usize) -> Result<String, String> {
    let invalid = || "Unerwarteter COPY-Kopf im Datenstrom.".to_string();
    if line.get(*index) == Some(&b'"') {
        *index += 1;
        let mut out = Vec::new();
        loop {
            match line.get(*index) {
                Some(b'"') if line.get(*index + 1) == Some(&b'"') => {
                    out.push(b'"');
                    *index += 2;
                }
                Some(b'"') => {
                    *index += 1;
                    break;
                }
                Some(byte) => {
                    out.push(*byte);
                    *index += 1;
                }
                None => return Err(invalid()),
            }
        }
        return String::from_utf8(out).map_err(|_| invalid());
    }
    let start = *index;
    while let Some(byte) = line.get(*index) {
        if matches!(byte, b'.' | b' ' | b',' | b'(' | b')') {
            break;
        }
        *index += 1;
    }
    if start == *index {
        return Err(invalid());
    }
    String::from_utf8(line[start..*index].to_vec()).map_err(|_| invalid())
}

pub fn parse_copy(line: &[u8]) -> Result<(String, String, Vec<String>), String> {
    let invalid = || "Unerwarteter COPY-Kopf im Datenstrom.".to_string();
    let body = line
        .strip_prefix(b"COPY ")
        .and_then(|rest| rest.strip_suffix(b" FROM stdin;"))
        .ok_or_else(invalid)?;
    let mut index = 0;
    let schema = parse_identifier(body, &mut index)?;
    if body.get(index) != Some(&b'.') {
        return Err(invalid());
    }
    index += 1;
    let table = parse_identifier(body, &mut index)?;
    let mut columns = Vec::new();
    if body.get(index..index + 2) == Some(b" (") {
        index += 2;
        loop {
            columns.push(parse_identifier(body, &mut index)?);
            match body.get(index) {
                Some(b',') if body.get(index + 1) == Some(&b' ') => index += 2,
                Some(b')') => {
                    index += 1;
                    break;
                }
                _ => return Err(invalid()),
            }
        }
    }
    if body[index..].iter().any(|byte| *byte != b' ') {
        return Err(invalid());
    }
    Ok((schema, table, columns))
}

pub fn unescape(field: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(field.len());
    let mut index = 0;
    while index < field.len() {
        let byte = field[index];
        if byte != b'\\' || index + 1 >= field.len() {
            out.push(byte);
            index += 1;
            continue;
        }
        let next = field[index + 1];
        index += 2;
        match next {
            b'b' => out.push(8),
            b'f' => out.push(12),
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'v' => out.push(11),
            b'0'..=b'7' => {
                let mut value = (next - b'0') as u32;
                for _ in 0..2 {
                    match field.get(index) {
                        Some(digit @ b'0'..=b'7') => {
                            value = value * 8 + (digit - b'0') as u32;
                            index += 1;
                        }
                        _ => break,
                    }
                }
                out.push(value as u8);
            }
            b'x' => {
                let mut value = 0u32;
                let mut digits = 0;
                while digits < 2 {
                    match field
                        .get(index)
                        .and_then(|digit| (*digit as char).to_digit(16))
                    {
                        Some(digit) => {
                            value = value * 16 + digit;
                            index += 1;
                            digits += 1;
                        }
                        None => break,
                    }
                }
                if digits == 0 {
                    out.push(b'x');
                } else {
                    out.push(value as u8);
                }
            }
            other => out.push(other),
        }
    }
    out
}

pub fn escape_into(value: &[u8], out: &mut Vec<u8>) {
    for byte in value {
        match byte {
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\t' => out.extend_from_slice(b"\\t"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            other => out.push(*other),
        }
    }
}

fn fit(text: String, limit: Option<usize>) -> String {
    match limit {
        Some(limit) if text.chars().count() > limit => text.chars().take(limit).collect(),
        _ => text,
    }
}

fn digest(key: &[u8], label: &str, value: &[u8]) -> [u8; 32] {
    let mut data = Vec::with_capacity(label.len() + 1 + value.len());
    data.extend_from_slice(label.as_bytes());
    data.push(0);
    data.extend_from_slice(value);
    crypto::mac(key, &data)
}

const FIRST: [&str; 24] = [
    "Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Henri", "Ida", "Jonas", "Lea",
    "Luca", "Mia", "Noah", "Olivia", "Paul", "Sophie", "Tim", "Lina", "Elias", "Marie", "Finn",
    "Nora", "Theo",
];
const LAST: [&str; 24] = [
    "Müller",
    "Schmidt",
    "Schneider",
    "Fischer",
    "Weber",
    "Meyer",
    "Wagner",
    "Becker",
    "Schulz",
    "Hoffmann",
    "Koch",
    "Richter",
    "Klein",
    "Wolf",
    "Schröder",
    "Neumann",
    "Schwarz",
    "Braun",
    "Zimmermann",
    "Krüger",
    "Hartmann",
    "Lange",
    "Werner",
    "Krause",
];

fn year_only(value: &[u8], timestamp: bool) -> String {
    let text = String::from_utf8_lossy(value);
    if text == "infinity" || text == "-infinity" {
        return text.into_owned();
    }
    let year: String = text.chars().take_while(char::is_ascii_digit).collect();
    if year.len() < 4 || text.chars().nth(year.len()) != Some('-') {
        return if timestamp {
            "1970-01-01 00:00:00".into()
        } else {
            "1970-01-01".into()
        };
    }
    let era = if text.ends_with(" BC") { " BC" } else { "" };
    if timestamp {
        format!("{year}-01-01 00:00:00{era}")
    } else {
        format!("{year}-01-01{era}")
    }
}

fn masked(plan: &Plan, value: &[u8], key: &[u8]) -> Option<String> {
    let limit = plan.max_length;
    Some(match plan.strategy {
        Strategy::Keep => return Some(String::from_utf8_lossy(value).into_owned()),
        Strategy::Null => return None,
        Strategy::Fixed => plan.value.clone().unwrap_or_default(),
        Strategy::Redact => fit("REDACTED".into(), limit),
        Strategy::Hash => fit(crypto::hex(&digest(key, "hash", value)[..16]), limit),
        Strategy::Email => fit(
            format!(
                "user_{}@example.invalid",
                crypto::hex(&digest(key, "email", value)[..8])
            ),
            limit,
        ),
        Strategy::Name => {
            let hash = digest(key, "name", value);
            fit(
                format!(
                    "{} {}",
                    FIRST[hash[0] as usize % FIRST.len()],
                    LAST[hash[1] as usize % LAST.len()]
                ),
                limit,
            )
        }
        Strategy::Phone => {
            let hash = digest(key, "phone", value);
            let number = u64::from_be_bytes(hash[..8].try_into().unwrap_or([0; 8])) % 100_000_000;
            fit(format!("+49 30 {number:08}"), limit)
        }
        Strategy::Partial => fit(
            crate::db::masking::partial_text(&String::from_utf8_lossy(value)),
            limit,
        ),
        Strategy::Ip => {
            let hash = digest(key, "ip", value);
            fit(format!("192.0.2.{}", hash[0] % 254 + 1), limit)
        }
        Strategy::Zero => "0".into(),
        Strategy::YearOnly => year_only(value, plan.category == Category::Timestamp),
        Strategy::Uuid => {
            let mut bytes = [0u8; 16];
            bytes.copy_from_slice(&digest(key, "uuid", value)[..16]);
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            let hex = crypto::hex(&bytes);
            format!(
                "{}-{}-{}-{}-{}",
                &hex[..8],
                &hex[8..12],
                &hex[12..16],
                &hex[16..20],
                &hex[20..]
            )
        }
        Strategy::EmptyJson => "{}".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroizing;

    fn column(table: &str, name: &str, data_type: &str, not_null: bool) -> Column {
        let category = category(data_type);
        Column {
            schema: "public".into(),
            table: table.into(),
            column: name.into(),
            data_type: data_type.into(),
            category,
            max_length: data_type
                .split_once('(')
                .and_then(|(_, rest)| rest.trim_end_matches(')').parse().ok()),
            not_null,
            generated: false,
            root_schema: "public".into(),
            root_table: table.into(),
            pii: detect(name, category, not_null),
        }
    }

    fn rule(table: &str, column: &str, strategy: Strategy) -> MaskRule {
        MaskRule {
            schema: "public".into(),
            table: table.into(),
            column: column.into(),
            strategy,
            value: None,
        }
    }

    fn columns() -> Vec<Column> {
        vec![
            column("customers", "id", "bigint", true),
            column("customers", "email", "text", true),
            column("customers", "name", "character varying(80)", false),
            column("customers", "birthday", "date", false),
            column("customers", "notes", "jsonb", false),
            column("orders", "id", "bigint", true),
            column("orders", "customer_email", "text", false),
            column("other", "id", "bigint", true),
        ]
    }

    fn run(masker: &mut Masker, input: &[u8], step: usize) -> Result<String, String> {
        let mut out = Vec::new();
        for part in input.chunks(step) {
            masker.feed(part, &mut out)?;
        }
        masker.finish(&mut out)?;
        Ok(String::from_utf8(out).unwrap())
    }

    #[test]
    fn detects_personal_columns() {
        assert_eq!(
            detect("email", Category::Text, true).unwrap().strategy,
            Some(Strategy::Email)
        );
        assert_eq!(
            detect("customerEmail", Category::Text, false)
                .unwrap()
                .reason,
            "E-Mail-Adresse"
        );
        assert_eq!(
            detect("Geburtsdatum", Category::Date, false)
                .unwrap()
                .strategy,
            Some(Strategy::YearOnly)
        );
        assert_eq!(
            detect("password_hash", Category::Text, true)
                .unwrap()
                .strategy,
            Some(Strategy::Redact)
        );
        assert_eq!(
            detect("last_name", Category::Text, false).unwrap().strategy,
            Some(Strategy::Name)
        );
        for column in [
            "username",
            "user_name",
            "login",
            "displayName",
            "Benutzername",
        ] {
            let found = detect(column, Category::Text, true).unwrap();
            assert_eq!(found.strategy, Some(Strategy::Hash), "{column}");
            assert_eq!(found.reason, "Benutzerkennung");
        }
        assert_eq!(
            detect("client_ip", Category::Inet, false).unwrap().strategy,
            Some(Strategy::Ip)
        );
        assert_eq!(
            detect("api_key", Category::Bytea, true).unwrap().strategy,
            None
        );
        assert!(detect("total", Category::Number, false).is_none());
        assert!(detect("name", Category::Text, false).is_none());
        assert!(detect("created_at", Category::Timestamp, false).is_none());
    }

    #[test]
    fn masks_copy_rows_deterministically_and_keeps_format() {
        let rules = vec![
            rule("customers", "email", Strategy::Email),
            rule("customers", "name", Strategy::Name),
            rule("customers", "birthday", Strategy::YearOnly),
            rule("orders", "customer_email", Strategy::Email),
        ];
        let input = b"--\n\\restrict k1\nSET x = 1;\nCOPY public.customers (id, email, name, birthday, notes) FROM stdin;\n1\tanna@corp.de\tAnna Echt\t1984-05-17\t{\"a\": 1}\n2\tbob\\\\x@corp.de\t\\N\t\\N\t\\N\n\\.\n\nCOPY public.orders (id, customer_email) FROM stdin;\n7\tanna@corp.de\n\\.\nCOPY public.other (id) FROM stdin;\nCOPY public.customers (id) FROM stdin;\n\\.\n";
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        let output = run(&mut masker, input, 7).unwrap();
        assert!(!output.contains("anna@corp.de"));
        assert!(!output.contains("Anna Echt"));
        assert!(!output.contains("1984-05-17"));
        assert!(output.contains("1984-01-01"));
        assert!(output.contains("{\"a\": 1}"));
        assert!(output.contains("2\tuser_"));
        assert!(output.contains("\\N\t\\N\t\\N"));
        assert!(output.contains(
            "COPY public.other (id) FROM stdin;\nCOPY public.customers (id) FROM stdin;\n\\."
        ));
        let emails: Vec<&str> = output
            .lines()
            .filter_map(|line| line.split('\t').find(|field| field.starts_with("user_")))
            .collect();
        assert_eq!(emails.len(), 3);
        assert_eq!(emails[0], emails[2]);
        assert_ne!(emails[0], emails[1]);
        assert_eq!(masker.stats.masked_tables, 2);
        assert_eq!(masker.stats.rows, 4);
        let again = run(
            &mut Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap(),
            input,
            3,
        )
        .unwrap();
        assert_eq!(output, again);
        let other = run(
            &mut Masker::new(&rules, &columns(), Zeroizing::new([2u8; 32])).unwrap(),
            input,
            64,
        )
        .unwrap();
        assert_ne!(output, other);
    }

    #[test]
    fn refuses_uncovered_pii_and_unsafe_streams() {
        let error = match Masker::new(
            &[rule("customers", "email", Strategy::Email)],
            &columns(),
            Zeroizing::new([1u8; 32]),
        ) {
            Err(error) => error,
            Ok(_) => panic!("expected uncovered columns"),
        };
        assert!(error.contains("public.customers.birthday"));
        assert!(!error.contains("public.customers.name"));
        assert!(error.contains("public.orders.customer_email"));
        let rules = vec![
            rule("customers", "email", Strategy::Email),
            rule("customers", "name", Strategy::Keep),
            rule("customers", "birthday", Strategy::Null),
            rule("orders", "customer_email", Strategy::Null),
        ];
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        assert!(run(&mut masker, b"--\nSET x = 1;\n", 100)
            .unwrap_err()
            .contains("restrict"));
        let guarded = |body: &[u8]| [b"\\restrict k\n".as_slice(), body].concat();
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        assert!(run(
            &mut masker,
            &guarded(b"SELECT pg_catalog.lowrite(0, '\\x41');\n"),
            100
        )
        .unwrap_err()
        .contains("Large Objects"));
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        assert!(run(
            &mut masker,
            &guarded(b"SELECT * FROM pg_catalog.pg_restore_attribute_stats(\n"),
            100
        )
        .is_err());
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        assert!(run(
            &mut masker,
            &guarded(b"COPY public.customers (id, email, birthday) FROM stdin;\n1\ta\n\\.\n"),
            100
        )
        .unwrap_err()
        .contains("Spaltenanzahl"));
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        assert!(run(
            &mut masker,
            &guarded(b"COPY public.customers (id) FROM stdin;\n1\n\\.\n"),
            100
        )
        .unwrap_err()
        .contains("fehlt im Datenstrom"));
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        assert!(run(
            &mut masker,
            &guarded(b"COPY public.ghost (id) FROM stdin;\n\\.\n"),
            100
        )
        .unwrap_err()
        .contains("Katalog"));
        let mut masker = Masker::new(&rules, &columns(), Zeroizing::new([1u8; 32])).unwrap();
        assert!(run(
            &mut masker,
            &guarded(b"COPY public.orders (id, customer_email) FROM stdin;\n1\tx\n"),
            100
        )
        .unwrap_err()
        .contains("COPY-Blocks"));
    }

    #[test]
    fn validates_rules_against_types() {
        let cols = columns();
        assert!(
            validate(&[rule("customers", "email", Strategy::Null)], &cols)
                .unwrap_err()
                .contains("NOT NULL")
        );
        assert!(validate(&[rule("customers", "notes", Strategy::Email)], &cols).is_err());
        assert!(
            validate(&[rule("customers", "missing", Strategy::Null)], &cols)
                .unwrap_err()
                .contains("unbekannte")
        );
        assert!(validate(&[rule("customers", "notes", Strategy::EmptyJson)], &cols).is_ok());
        assert!(
            validate(&[rule("customers", "notes", Strategy::Fixed)], &cols)
                .unwrap_err()
                .contains("Ersatzwert")
        );
        let doubled = vec![
            rule("customers", "notes", Strategy::Null),
            rule("customers", "notes", Strategy::Null),
        ];
        assert!(validate(&doubled, &cols).unwrap_err().contains("Doppelte"));
    }

    #[test]
    fn parses_quoted_copy_headers_and_escapes() {
        let (schema, table, columns) = parse_copy(
            b"COPY \"Sales\".\"Order \"\"Items\"\"\" (id, \"E-Mail\", \"a, b\") FROM stdin;",
        )
        .unwrap();
        assert_eq!(schema, "Sales");
        assert_eq!(table, "Order \"Items\"");
        assert_eq!(columns, vec!["id", "E-Mail", "a, b"]);
        assert_eq!(
            parse_copy(b"COPY public.empty  FROM stdin;")
                .unwrap()
                .2
                .len(),
            0
        );
        assert!(parse_copy(b"COPY public.t (id) TO stdout;").is_err());
        assert_eq!(unescape(b"a\\tb\\\\c\\101\\x42\\n"), b"a\tb\\cAB\n");
        let mut out = Vec::new();
        escape_into(b"a\tb\\c\nd", &mut out);
        assert_eq!(out, b"a\\tb\\\\c\\nd");
        assert_eq!(
            masked(
                &Plan {
                    strategy: Strategy::Email,
                    value: None,
                    category: Category::Text,
                    max_length: Some(12)
                },
                b"x",
                &[0; 32]
            )
            .unwrap()
            .chars()
            .count(),
            12
        );
        assert_eq!(
            year_only(b"2001-02-03 04:05:06+02", true),
            "2001-01-01 00:00:00"
        );
        assert_eq!(year_only(b"0044-03-15 BC", false), "0044-01-01 BC");
        assert_eq!(year_only(b"infinity", false), "infinity");
    }
}
