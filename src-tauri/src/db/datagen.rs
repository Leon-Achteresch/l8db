use std::collections::{HashMap, HashSet};

use chrono::{Duration, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::datagen_data as data;
use super::pool::PoolState;
use super::transaction::TransactionState;
use super::{DatabaseAdapter, DatabaseKind};

pub const PREVIEW_ROWS: u64 = 20;
pub const MAX_ROWS: u64 = 50_000_000;
const REFERENCE_SAMPLE: usize = 10_000;
const UNIQUE_ATTEMPTS: u32 = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Locale {
    #[default]
    De,
    En,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Generator {
    Skip,
    Null,
    Fixed {
        value: String,
    },
    List {
        values: Vec<String>,
    },
    Pattern {
        pattern: String,
    },
    Sequence {
        start: i64,
        step: i64,
    },
    Sql {
        expression: String,
    },
    Reference {
        schema: String,
        table: String,
        column: String,
    },
    Email,
    FirstName,
    LastName,
    FullName,
    Username,
    Company,
    City,
    Street,
    PostalCode,
    Country,
    Phone,
    Iban,
    Uuid,
    Url,
    Ip,
    Integer {
        min: i64,
        max: i64,
    },
    Decimal {
        min: f64,
        max: f64,
        scale: u32,
    },
    Boolean,
    Date {
        from: String,
        to: String,
    },
    Timestamp {
        from: String,
        to: String,
    },
    Time,
    Lorem {
        min: usize,
        max: usize,
    },
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPlan {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    #[serde(default)]
    pub max_length: Option<u32>,
    pub generator: Generator,
    #[serde(default)]
    pub null_ratio: f64,
    #[serde(default)]
    pub enum_values: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatagenPlan {
    pub columns: Vec<ColumnPlan>,
    pub unique: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskedCopy {
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub masks: Vec<super::export::ColumnMask>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatagenRequest {
    pub schema: String,
    pub table: String,
    pub rows: u64,
    #[serde(default = "default_batch")]
    pub batch_size: u32,
    #[serde(default)]
    pub seed: u64,
    #[serde(default)]
    pub locale: Locale,
    #[serde(default = "yes")]
    pub transaction: bool,
    pub columns: Vec<ColumnPlan>,
    #[serde(default)]
    pub unique: Vec<Vec<String>>,
    #[serde(default)]
    pub source: Option<MaskedCopy>,
}

fn default_batch() -> u32 {
    1_000
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatagenPreview {
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatagenOutcome {
    pub inserted: u64,
    pub cancelled: bool,
    pub committed: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Val {
    Null,
    Int(i64),
    Num(String),
    Bool(bool),
    Text(String),
    Date(String),
    Timestamp(String),
    Time(String),
    Json(String),
    Raw(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Int,
    Float,
    Decimal,
    Bool,
    Date,
    Timestamp,
    Time,
    Uuid,
    Json,
    Text,
    Binary,
    ObjectId,
}

pub fn supported(kind: DatabaseKind) -> bool {
    matches!(
        kind,
        DatabaseKind::Postgres
            | DatabaseKind::Mysql
            | DatabaseKind::Sqlite
            | DatabaseKind::Mssql
            | DatabaseKind::Oracle
            | DatabaseKind::Mongodb
    )
}

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed ^ 0x9E37_79B9_7F4A_7C15)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }

    pub fn range(&mut self, min: i64, max: i64) -> i64 {
        if max <= min {
            return min;
        }
        let span = (max as i128 - min as i128 + 1) as u128;
        (min as i128 + (self.next_u64() as u128 % span) as i128) as i64
    }

    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn pick<'a>(&mut self, list: &[&'a str]) -> &'a str {
        list[self.below(list.len() as u64) as usize]
    }
}

fn mix(seed: u64, row: u64, column: usize, attempt: u32) -> u64 {
    let mut rng = Rng::new(
        seed ^ row.wrapping_mul(0x0100_0000_01B3)
            ^ (column as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F)
            ^ (attempt as u64).rotate_left(47),
    );
    rng.next_u64()
}

pub fn category(data_type: &str) -> Category {
    let t = data_type.to_lowercase();
    let base = t.split('(').next().unwrap_or("").trim();
    if base == "objectid" {
        return Category::ObjectId;
    }
    if base.contains("uuid") || base == "uniqueidentifier" {
        return Category::Uuid;
    }
    if base.contains("json") || base == "object" || base == "array" {
        return Category::Json;
    }
    if base.contains("bool") || base == "bit" {
        return Category::Bool;
    }
    if base.starts_with("timestamp") || base.contains("datetime") || base == "smalldatetime" {
        return Category::Timestamp;
    }
    if base == "date" {
        return Category::Date;
    }
    if base.starts_with("time") {
        return Category::Time;
    }
    if base.contains("int") || base == "serial" || base == "bigserial" || base == "long" {
        return Category::Int;
    }
    if base.contains("numeric")
        || base.contains("decimal")
        || base == "money"
        || base == "smallmoney"
        || base == "number"
    {
        return Category::Decimal;
    }
    if base.contains("float")
        || base.contains("double")
        || base == "real"
        || base == "binary_float"
        || base == "binary_double"
    {
        return Category::Float;
    }
    if base.contains("blob")
        || base.contains("binary")
        || base == "bytea"
        || base == "raw"
        || base == "image"
        || base == "bindata"
    {
        return Category::Binary;
    }
    Category::Text
}

fn type_args(data_type: &str) -> Vec<i64> {
    let Some(open) = data_type.find('(') else {
        return Vec::new();
    };
    let close = data_type[open..]
        .find(')')
        .map(|i| open + i)
        .unwrap_or(data_type.len());
    data_type[open + 1..close]
        .split(',')
        .filter_map(|part| part.trim().parse().ok())
        .collect()
}

fn int_bounds(data_type: &str, kind: DatabaseKind) -> (i64, i64) {
    let t = data_type.to_lowercase();
    if t.contains("tinyint") {
        return if kind == DatabaseKind::Mssql {
            (0, 255)
        } else {
            (-128, 127)
        };
    }
    if t.contains("smallint") || t == "int2" {
        return (-32_768, 32_767);
    }
    if t.contains("mediumint") {
        return (-8_388_608, 8_388_607);
    }
    if t.contains("bigint") || t == "int8" || t == "long" {
        return (i64::MIN, i64::MAX);
    }
    (i32::MIN as i64, i32::MAX as i64)
}

fn decimal_bounds(data_type: &str) -> (f64, u32) {
    let args = type_args(data_type);
    match args.as_slice() {
        [precision, scale, ..] if *precision > 0 => {
            let digits = (*precision - *scale).clamp(0, 15) as i32;
            (10f64.powi(digits) - 1.0, (*scale).clamp(0, 10) as u32)
        }
        [precision] if *precision > 0 => (10f64.powi((*precision).clamp(1, 15) as i32) - 1.0, 0),
        _ => (1_000_000.0, 2),
    }
}

fn has(name: &str, words: &[&str]) -> bool {
    words.iter().any(|word| name.contains(word))
}

fn is_word(name: &str, words: &[&str]) -> bool {
    let parts: Vec<&str> = name.split(['_', '-', ' ', '.']).collect();
    words
        .iter()
        .any(|word| parts.contains(word) || name == *word)
}

fn years_ago(years: i64) -> String {
    (Utc::now().date_naive() - Duration::days(365 * years))
        .format("%Y-%m-%d")
        .to_string()
}

fn today() -> String {
    Utc::now().date_naive().format("%Y-%m-%d").to_string()
}

pub fn infer(
    name: &str,
    data_type: &str,
    kind: DatabaseKind,
    max_length: Option<u32>,
) -> Generator {
    let n = name.to_lowercase();
    let cat = category(data_type);
    match cat {
        Category::ObjectId => return Generator::Skip,
        Category::Uuid => return Generator::Uuid,
        Category::Bool => return Generator::Boolean,
        Category::Json => return Generator::Json,
        Category::Time => return Generator::Time,
        Category::Binary => return Generator::Null,
        Category::Date | Category::Timestamp => {
            let (from, to) = if has(&n, &["birth", "geburt", "dob"]) {
                (years_ago(80), years_ago(18))
            } else {
                (years_ago(5), today())
            };
            return if cat == Category::Date {
                Generator::Date { from, to }
            } else {
                Generator::Timestamp { from, to }
            };
        }
        Category::Int => {
            let (lo, hi) = int_bounds(data_type, kind);
            let (min, max) = if is_word(&n, &["age", "alter"]) {
                (18, 90)
            } else if is_word(&n, &["year", "jahr"]) {
                (1990, 2030)
            } else if has(
                &n,
                &["qty", "quantity", "menge", "count", "anzahl", "stock"],
            ) {
                (1, 100)
            } else if has(
                &n,
                &["price", "preis", "amount", "betrag", "total", "summe"],
            ) {
                (1, 1000)
            } else {
                (1, 100_000)
            };
            return Generator::Integer {
                min: min.clamp(lo.max(0), hi),
                max: max.clamp(lo.max(0), hi),
            };
        }
        Category::Decimal | Category::Float => {
            let (limit, scale) = if cat == Category::Decimal {
                decimal_bounds(data_type)
            } else {
                (1_000_000.0, 2)
            };
            let max: f64 = if has(
                &n,
                &["price", "preis", "amount", "betrag", "total", "summe"],
            ) {
                1000.0
            } else {
                10_000.0
            };
            return Generator::Decimal {
                min: 0.0,
                max: max.min(limit),
                scale,
            };
        }
        Category::Text => {}
    }
    let limit = max_length.map(|len| len as usize).unwrap_or(usize::MAX);
    let text = if has(&n, &["email", "e_mail", "mail"]) {
        Generator::Email
    } else if has(&n, &["first_name", "firstname", "vorname", "given_name"]) {
        Generator::FirstName
    } else if has(
        &n,
        &[
            "last_name",
            "lastname",
            "nachname",
            "surname",
            "family_name",
        ],
    ) {
        Generator::LastName
    } else if has(&n, &["username", "user_name", "login", "nickname"]) {
        Generator::Username
    } else if has(&n, &["company", "firma", "organisation", "organization"]) {
        Generator::Company
    } else if has(&n, &["full_name", "fullname"]) || is_word(&n, &["name", "customer", "kunde"]) {
        Generator::FullName
    } else if has(&n, &["city", "stadt"]) || is_word(&n, &["ort", "town"]) {
        Generator::City
    } else if has(&n, &["street", "strasse", "straße", "address", "adresse"]) {
        Generator::Street
    } else if has(&n, &["zip", "postal", "postcode"]) || is_word(&n, &["plz"]) {
        Generator::PostalCode
    } else if has(&n, &["country", "land"]) {
        Generator::Country
    } else if has(&n, &["phone", "telefon", "mobile", "handy", "fax"]) || is_word(&n, &["tel"]) {
        Generator::Phone
    } else if has(&n, &["iban"]) {
        Generator::Iban
    } else if has(&n, &["uuid", "guid"]) {
        Generator::Uuid
    } else if has(&n, &["url", "website", "homepage", "link"]) {
        Generator::Url
    } else if is_word(&n, &["ip", "ip_address", "ipaddress", "ip_addr"]) {
        Generator::Ip
    } else if has(
        &n,
        &[
            "description",
            "beschreibung",
            "comment",
            "kommentar",
            "notes",
            "note",
            "bemerkung",
            "text",
            "body",
            "content",
            "inhalt",
        ],
    ) {
        Generator::Lorem {
            min: 20.min(limit),
            max: 200.min(limit),
        }
    } else if has(&n, &["title", "titel", "subject", "betreff", "label"]) {
        Generator::Lorem {
            min: 10.min(limit),
            max: 40.min(limit),
        }
    } else if has(&n, &["code", "sku", "number", "nummer", "ref"]) {
        Generator::Pattern {
            pattern: "???-#####".into(),
        }
    } else {
        Generator::Lorem {
            min: 5.min(limit),
            max: 30.min(limit),
        }
    };
    match text {
        Generator::Uuid if limit < 36 => Generator::Lorem {
            min: 1.min(limit),
            max: limit,
        },
        other => other,
    }
}

fn transliterate(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        match c {
            'ä' | 'Ä' => out.push_str("ae"),
            'ö' | 'Ö' => out.push_str("oe"),
            'ü' | 'Ü' => out.push_str("ue"),
            'ß' => out.push_str("ss"),
            c if c.is_ascii_alphanumeric() => out.push(c.to_ascii_lowercase()),
            _ => {}
        }
    }
    out
}

fn first_names(locale: Locale) -> &'static [&'static str] {
    match locale {
        Locale::De => data::FIRST_DE,
        Locale::En => data::FIRST_EN,
    }
}

fn last_names(locale: Locale) -> &'static [&'static str] {
    match locale {
        Locale::De => data::LAST_DE,
        Locale::En => data::LAST_EN,
    }
}

fn digits(rng: &mut Rng, count: usize) -> String {
    (0..count)
        .map(|_| char::from(b'0' + rng.below(10) as u8))
        .collect()
}

fn mod97(digits: &str) -> u32 {
    digits
        .chars()
        .filter_map(|c| c.to_digit(10))
        .fold(0u32, |acc, d| (acc * 10 + d) % 97)
}

pub fn iban(rng: &mut Rng) -> String {
    let bban = digits(rng, 18);
    let check = 98 - mod97(&format!("{bban}131400"));
    format!("DE{check:02}{bban}")
}

fn uuid(rng: &mut Rng) -> String {
    let a = rng.next_u64();
    let b = rng.next_u64();
    let bytes: Vec<u8> = a.to_be_bytes().into_iter().chain(b.to_be_bytes()).collect();
    let mut hex: Vec<String> = bytes.iter().map(|b| format!("{b:02x}")).collect();
    hex[6] = format!("4{}", &hex[6][1..]);
    let variant = (u8::from_str_radix(&hex[8], 16).unwrap_or(0) & 0x3f) | 0x80;
    hex[8] = format!("{variant:02x}");
    let h = hex.concat();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn lorem(rng: &mut Rng, min: usize, max: usize) -> String {
    let max = max.max(1);
    let target = rng.range(min.min(max) as i64, max as i64).max(1) as usize;
    let mut out = String::new();
    while out.chars().count() < target {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(rng.pick(data::WORDS));
    }
    let mut text: String = out.chars().take(target).collect();
    if let Some(first) = text.get(0..1) {
        text = format!("{}{}", first.to_uppercase(), &text[1..]);
    }
    text.trim_end().to_string()
}

fn pattern(rng: &mut Rng, pattern: &str, row: u64) -> String {
    let mut out = String::new();
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        match c {
            '#' => out.push(char::from(b'0' + rng.below(10) as u8)),
            '?' => out.push(char::from(b'A' + rng.below(26) as u8)),
            '@' => out.push(char::from(b'a' + rng.below(26) as u8)),
            '*' => {
                let n = rng.below(36) as u8;
                out.push(if n < 10 {
                    char::from(b'0' + n)
                } else {
                    char::from(b'a' + n - 10)
                });
            }
            '%' => out.push_str(&(row + 1).to_string()),
            '\\' => {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            }
            other => out.push(other),
        }
    }
    out
}

fn parse_date(text: &str) -> Option<NaiveDateTime> {
    let text = text.trim();
    NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S"))
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(text, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(0, 0, 0))
        })
}

fn date_between(rng: &mut Rng, from: &str, to: &str) -> Result<NaiveDateTime, String> {
    let start = parse_date(from).ok_or_else(|| format!("Ungültiges Datum: {from}"))?;
    let end = parse_date(to).ok_or_else(|| format!("Ungültiges Datum: {to}"))?;
    let (start, end) = if end < start {
        (end, start)
    } else {
        (start, end)
    };
    let span = (end - start).num_seconds();
    Ok(start + Duration::seconds(rng.range(0, span)))
}

pub fn typed(text: &str, cat: Category) -> Val {
    match cat {
        Category::Int => text
            .trim()
            .parse::<i64>()
            .map(Val::Int)
            .unwrap_or_else(|_| Val::Text(text.to_string())),
        Category::Float | Category::Decimal => {
            if text.trim().parse::<f64>().is_ok_and(f64::is_finite) {
                Val::Num(text.trim().to_string())
            } else {
                Val::Text(text.to_string())
            }
        }
        Category::Bool => match text.trim().to_lowercase().as_str() {
            "true" | "t" | "1" | "yes" | "ja" => Val::Bool(true),
            "false" | "f" | "0" | "no" | "nein" => Val::Bool(false),
            _ => Val::Text(text.to_string()),
        },
        Category::Date => Val::Date(text.to_string()),
        Category::Timestamp => Val::Timestamp(text.to_string()),
        Category::Time => Val::Time(text.to_string()),
        Category::Json => Val::Json(text.to_string()),
        _ => Val::Text(text.to_string()),
    }
}

fn from_json(value: &Value, cat: Category) -> Val {
    match value {
        Value::Null => Val::Null,
        Value::Bool(b) => Val::Bool(*b),
        Value::Number(n) => n
            .as_i64()
            .map(Val::Int)
            .unwrap_or_else(|| Val::Num(n.to_string())),
        Value::String(s) => typed(s, cat),
        other => Val::Json(other.to_string()),
    }
}

pub struct Context {
    pub locale: Locale,
    pub references: HashMap<String, Vec<Value>>,
}

pub fn reference_key(schema: &str, table: &str, column: &str) -> String {
    format!("{schema}\u{1}{table}\u{1}{column}")
}

pub fn generate(
    column: &ColumnPlan,
    rng: &mut Rng,
    row: u64,
    ctx: &Context,
) -> Result<Val, String> {
    let cat = category(&column.data_type);
    if column.nullable && column.null_ratio > 0.0 && rng.unit() < column.null_ratio {
        return Ok(Val::Null);
    }
    let locale = ctx.locale;
    let value = match &column.generator {
        Generator::Skip | Generator::Null => Val::Null,
        Generator::Fixed { value } => typed(value, cat),
        Generator::List { values } => {
            if values.is_empty() {
                Val::Null
            } else {
                typed(&values[rng.below(values.len() as u64) as usize], cat)
            }
        }
        Generator::Pattern { pattern: p } => typed(&pattern(rng, p, row), cat),
        Generator::Sequence { start, step } => {
            let value = start.saturating_add(step.saturating_mul(row as i64));
            if matches!(cat, Category::Int | Category::Decimal | Category::Float) {
                Val::Int(value)
            } else {
                Val::Text(value.to_string())
            }
        }
        Generator::Sql { expression } => Val::Raw(expression.clone()),
        Generator::Reference {
            schema,
            table,
            column: parent,
        } => {
            let keys = ctx
                .references
                .get(&reference_key(schema, table, parent))
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            if keys.is_empty() {
                if column.nullable {
                    Val::Null
                } else {
                    return Err(format!(
                        "Keine Schlüssel in {schema}.{table}.{parent} für {} gefunden.",
                        column.name
                    ));
                }
            } else {
                from_json(&keys[rng.below(keys.len() as u64) as usize], cat)
            }
        }
        Generator::Email => {
            let first = transliterate(rng.pick(first_names(locale)));
            let last = transliterate(rng.pick(last_names(locale)));
            let domain = rng.pick(match locale {
                Locale::De => data::DOMAIN_DE,
                Locale::En => data::DOMAIN_EN,
            });
            Val::Text(format!("{first}.{last}{}@{domain}", row + 1))
        }
        Generator::FirstName => Val::Text(rng.pick(first_names(locale)).to_string()),
        Generator::LastName => Val::Text(rng.pick(last_names(locale)).to_string()),
        Generator::FullName => Val::Text(format!(
            "{} {}",
            rng.pick(first_names(locale)),
            rng.pick(last_names(locale))
        )),
        Generator::Username => {
            let first = transliterate(rng.pick(first_names(locale)));
            let last = transliterate(rng.pick(last_names(locale)));
            Val::Text(format!("{}{last}{}", &first[..1], row + 1))
        }
        Generator::Company => Val::Text(format!(
            "{} {}",
            rng.pick(last_names(locale)),
            rng.pick(match locale {
                Locale::De => data::COMPANY_DE,
                Locale::En => data::COMPANY_EN,
            })
        )),
        Generator::City => Val::Text(
            rng.pick(match locale {
                Locale::De => data::CITY_DE,
                Locale::En => data::CITY_EN,
            })
            .to_string(),
        ),
        Generator::Street => Val::Text(format!(
            "{} {}",
            rng.pick(match locale {
                Locale::De => data::STREET_DE,
                Locale::En => data::STREET_EN,
            }),
            rng.range(1, 199)
        )),
        Generator::PostalCode => typed(
            &match locale {
                Locale::De => format!("{:05}", rng.range(1067, 99998)),
                Locale::En => format!("{:05}", rng.range(10001, 99950)),
            },
            cat,
        ),
        Generator::Country => Val::Text(
            rng.pick(match locale {
                Locale::De => data::COUNTRY_DE,
                Locale::En => data::COUNTRY_EN,
            })
            .to_string(),
        ),
        Generator::Phone => Val::Text(match locale {
            Locale::De => format!("+49 1{} {}", digits(rng, 2), digits(rng, 7)),
            Locale::En => format!("+1 555 {}-{}", digits(rng, 3), digits(rng, 4)),
        }),
        Generator::Iban => Val::Text(iban(rng)),
        Generator::Uuid => Val::Text(uuid(rng)),
        Generator::Url => Val::Text(format!(
            "https://www.{}.{}/{}",
            rng.pick(data::WORDS),
            rng.pick(&["de", "com", "org", "net"]),
            rng.pick(data::WORDS)
        )),
        Generator::Ip => Val::Text(format!(
            "{}.{}.{}.{}",
            rng.range(1, 223),
            rng.range(0, 255),
            rng.range(0, 255),
            rng.range(1, 254)
        )),
        Generator::Integer { min, max } => {
            let value = rng.range(*min, *max);
            if matches!(cat, Category::Int | Category::Decimal | Category::Float) {
                Val::Int(value)
            } else {
                Val::Text(value.to_string())
            }
        }
        Generator::Decimal { min, max, scale } => {
            let raw = min + (max - min) * rng.unit();
            let text = format!("{raw:.prec$}", prec = *scale as usize);
            if matches!(cat, Category::Int) {
                Val::Int(raw.round() as i64)
            } else if matches!(cat, Category::Decimal | Category::Float) {
                Val::Num(text)
            } else {
                Val::Text(text)
            }
        }
        Generator::Boolean => {
            let value = rng.below(2) == 1;
            if cat == Category::Bool {
                Val::Bool(value)
            } else if cat == Category::Int {
                Val::Int(value as i64)
            } else {
                Val::Text(value.to_string())
            }
        }
        Generator::Date { from, to } => {
            Val::Date(date_between(rng, from, to)?.format("%Y-%m-%d").to_string())
        }
        Generator::Timestamp { from, to } => Val::Timestamp(
            date_between(rng, from, to)?
                .format("%Y-%m-%d %H:%M:%S")
                .to_string(),
        ),
        Generator::Time => Val::Time(format!(
            "{:02}:{:02}:{:02}",
            rng.range(0, 23),
            rng.range(0, 59),
            rng.range(0, 59)
        )),
        Generator::Lorem { min, max } => Val::Text(lorem(rng, *min, *max)),
        Generator::Json => Val::Json(
            json!({
                "id": rng.range(1, 100_000),
                "tag": rng.pick(data::WORDS),
                "active": rng.below(2) == 1,
            })
            .to_string(),
        ),
    };
    Ok(match (value, column.max_length) {
        (Val::Text(text), Some(limit)) if text.chars().count() > limit as usize => {
            Val::Text(text.chars().take(limit as usize).collect())
        }
        (value, _) => value,
    })
}

pub fn fake_for_column(column: &str, seed: u64) -> String {
    let plan = ColumnPlan {
        name: column.to_string(),
        data_type: "text".into(),
        nullable: false,
        max_length: None,
        generator: infer(column, "text", DatabaseKind::Postgres, None),
        null_ratio: 0.0,
        enum_values: Vec::new(),
        note: None,
    };
    let ctx = Context {
        locale: Locale::De,
        references: HashMap::new(),
    };
    let mut rng = Rng::new(seed);
    match generate(&plan, &mut rng, seed % 100_000, &ctx) {
        Ok(Val::Text(text)) | Ok(Val::Num(text)) | Ok(Val::Json(text)) => text,
        Ok(Val::Int(n)) => n.to_string(),
        _ => lorem(&mut rng, 5, 20),
    }
}

pub struct RowFactory {
    columns: Vec<ColumnPlan>,
    unique: Vec<Vec<usize>>,
    seen: Vec<HashSet<String>>,
    seed: u64,
    ctx: Context,
}

impl RowFactory {
    pub fn new(request: &DatagenRequest, ctx: Context) -> Result<Self, String> {
        let indices: Vec<usize> = request
            .columns
            .iter()
            .enumerate()
            .filter(|(_, c)| c.generator != Generator::Skip)
            .map(|(i, _)| i)
            .collect();
        if indices.is_empty() {
            return Err("Keine Spalte zum Befüllen ausgewählt.".into());
        }
        let columns: Vec<ColumnPlan> = indices
            .iter()
            .map(|i| request.columns[*i].clone())
            .collect();
        let unique: Vec<Vec<usize>> = request
            .unique
            .iter()
            .filter_map(|set| {
                set.iter()
                    .map(|name| columns.iter().position(|c| &c.name == name))
                    .collect::<Option<Vec<usize>>>()
            })
            .filter(|set| !set.is_empty())
            .collect();
        for column in &columns {
            if !column.nullable && column.generator == Generator::Null {
                return Err(format!(
                    "Spalte {} ist NOT NULL und kann nicht leer bleiben.",
                    column.name
                ));
            }
        }
        Ok(Self {
            seen: vec![HashSet::new(); unique.len()],
            columns,
            unique,
            seed: request.seed,
            ctx,
        })
    }

    pub fn columns(&self) -> &[ColumnPlan] {
        &self.columns
    }

    pub fn row(&mut self, index: u64) -> Result<Vec<Val>, String> {
        for attempt in 0..UNIQUE_ATTEMPTS {
            let mut values = Vec::with_capacity(self.columns.len());
            for (position, column) in self.columns.iter().enumerate() {
                let mut rng = Rng::new(mix(self.seed, index, position, attempt));
                let mut value = generate(column, &mut rng, index, &self.ctx)?;
                if attempt > 0 && matches!(column.generator, Generator::Email | Generator::Username)
                {
                    if let Val::Text(text) = &value {
                        value = Val::Text(text.replacen('@', &format!("-{attempt}@"), 1));
                    }
                }
                values.push(value);
            }
            let keys: Vec<Option<String>> = self
                .unique
                .iter()
                .map(|set| {
                    if set.iter().any(|i| values[*i] == Val::Null) {
                        None
                    } else {
                        Some(
                            set.iter()
                                .map(|i| format!("{:?}", values[*i]))
                                .collect::<Vec<_>>()
                                .join("\u{1}"),
                        )
                    }
                })
                .collect();
            let clash = keys
                .iter()
                .zip(&self.seen)
                .any(|(key, seen)| key.as_ref().is_some_and(|k| seen.contains(k)));
            if clash {
                continue;
            }
            for (key, seen) in keys.into_iter().zip(self.seen.iter_mut()) {
                if let Some(key) = key {
                    seen.insert(key);
                }
            }
            return Ok(values);
        }
        let names: Vec<String> = self
            .unique
            .iter()
            .map(|set| {
                set.iter()
                    .map(|i| self.columns[*i].name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .collect();
        Err(format!(
            "Keine eindeutigen Werte mehr für ({}) nach {UNIQUE_ATTEMPTS} Versuchen in Zeile {}. Wertebereich vergrößern oder Sequenz verwenden.",
            names.join("; "),
            index + 1
        ))
    }
}

fn quote(kind: DatabaseKind, ident: &str) -> String {
    match kind {
        DatabaseKind::Mysql => super::mysql::quote(ident),
        DatabaseKind::Mssql => super::mssql::quote(ident),
        DatabaseKind::Sqlite => super::sqlite::quote(ident),
        DatabaseKind::Oracle => super::oracle::quote(ident),
        _ => super::quote_ident(ident),
    }
}

pub fn qualified(kind: DatabaseKind, schema: &str, table: &str) -> String {
    if schema.is_empty() {
        quote(kind, table)
    } else {
        format!("{}.{}", quote(kind, schema), quote(kind, table))
    }
}

fn text_literal(kind: DatabaseKind, text: &str) -> String {
    match kind {
        DatabaseKind::Mysql => super::mysql::lit(text),
        DatabaseKind::Mssql => super::mssql::lit(text),
        _ => super::quote_literal(text),
    }
}

pub fn literal(kind: DatabaseKind, value: &Val) -> String {
    match value {
        Val::Null => "NULL".into(),
        Val::Int(n) => n.to_string(),
        Val::Num(n) => n.clone(),
        Val::Bool(b) => match kind {
            DatabaseKind::Postgres | DatabaseKind::Mysql => {
                if *b { "TRUE" } else { "FALSE" }.into()
            }
            _ => if *b { "1" } else { "0" }.into(),
        },
        Val::Text(t) | Val::Json(t) | Val::Time(t) => text_literal(kind, t),
        Val::Date(d) => match kind {
            DatabaseKind::Oracle => format!("DATE {}", text_literal(kind, d)),
            _ => text_literal(kind, d),
        },
        Val::Timestamp(t) => match kind {
            DatabaseKind::Oracle => format!("TIMESTAMP {}", text_literal(kind, t)),
            DatabaseKind::Mssql => text_literal(kind, &t.replacen(' ', "T", 1)),
            _ => text_literal(kind, t),
        },
        Val::Raw(sql) => sql.clone(),
    }
}

pub fn json_value(value: &Val, mongo: bool) -> Value {
    match value {
        Val::Null => Value::Null,
        Val::Int(n) => json!(n),
        Val::Num(n) => n
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(n.clone())),
        Val::Bool(b) => Value::Bool(*b),
        Val::Json(t) => {
            if mongo {
                serde_json::from_str(t).unwrap_or_else(|_| Value::String(t.clone()))
            } else {
                Value::String(t.clone())
            }
        }
        Val::Date(d) if mongo => json!({ "$date": format!("{d}T00:00:00Z") }),
        Val::Timestamp(t) if mongo => json!({ "$date": format!("{}Z", t.replacen(' ', "T", 1)) }),
        Val::Text(t) | Val::Date(t) | Val::Timestamp(t) | Val::Time(t) | Val::Raw(t) => {
            Value::String(t.clone())
        }
    }
}

pub fn batch_limit(kind: DatabaseKind, requested: u32) -> usize {
    let cap = match kind {
        DatabaseKind::Mssql => 1_000,
        DatabaseKind::Oracle => 500,
        _ => 10_000,
    };
    (requested.max(1) as usize).min(cap)
}

pub fn insert_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[ColumnPlan],
    rows: &[Vec<Val>],
) -> Result<String, String> {
    if kind == DatabaseKind::Mongodb {
        if columns
            .iter()
            .any(|c| matches!(c.generator, Generator::Sql { .. }))
        {
            return Err("SQL-Ausdrücke werden für MongoDB nicht unterstützt.".into());
        }
        let documents: Vec<Value> = rows
            .iter()
            .map(|row| {
                Value::Object(
                    columns
                        .iter()
                        .zip(row)
                        .map(|(c, v)| (c.name.clone(), json_value(v, true)))
                        .collect(),
                )
            })
            .collect();
        return Ok(json!({ "insert": table, "documents": documents, "ordered": true }).to_string());
    }
    let target = qualified(kind, schema, table);
    let names = columns
        .iter()
        .map(|c| quote(kind, &c.name))
        .collect::<Vec<_>>()
        .join(", ");
    let tuples: Vec<String> = rows
        .iter()
        .map(|row| {
            format!(
                "({})",
                row.iter()
                    .map(|v| literal(kind, v))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
        .collect();
    if kind == DatabaseKind::Oracle {
        let parts: Vec<String> = tuples
            .iter()
            .map(|tuple| format!("INTO {target} ({names}) VALUES {tuple}"))
            .collect();
        return Ok(format!("INSERT ALL {} SELECT 1 FROM DUAL", parts.join(" ")));
    }
    Ok(format!(
        "INSERT INTO {target} ({names}) VALUES {}",
        tuples.join(", ")
    ))
}

fn cell<'a>(row: &'a Value, key: &str) -> Option<&'a Value> {
    let object = row.as_object()?;
    object.get(key).or_else(|| {
        object
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
    })
}

fn cell_text(row: &Value, key: &str) -> String {
    match cell(row, key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn cell_flag(row: &Value, key: &str) -> bool {
    match cell(row, key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(s)) => matches!(s.to_lowercase().as_str(), "t" | "true" | "1" | "yes"),
        _ => false,
    }
}

fn quoted_values(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\'' {
            continue;
        }
        let mut value = String::new();
        while let Some(n) = chars.next() {
            if n == '\'' {
                if chars.peek() == Some(&'\'') {
                    chars.next();
                    value.push('\'');
                } else {
                    break;
                }
            } else {
                value.push(n);
            }
        }
        out.push(value);
    }
    out
}

pub fn enum_from_type(full_type: &str) -> Vec<String> {
    let lower = full_type.trim().to_lowercase();
    if lower.starts_with("enum(") || lower.starts_with("set(") {
        quoted_values(full_type)
    } else {
        Vec::new()
    }
}

pub fn enum_from_check(definition: &str, columns: &[String]) -> Option<(String, Vec<String>)> {
    let re = regex::Regex::new(
        r#"(?is)[\[`"(]?([A-Za-z_][\w$]*)[\]`"]?\)?\s*(?:::\s*\w+\s*)?(?:=\s*ANY\s*\(\s*\(?\s*ARRAY\s*\[(.*?)\]|IN\s*\((.*?)\))"#,
    )
    .ok()?;
    let caps = re.captures(definition)?;
    let body = caps.get(2).or_else(|| caps.get(3))?.as_str();
    let values = quoted_values(body);
    if values.is_empty() {
        return None;
    }
    let name = caps.get(1)?.as_str().to_string();
    let column = columns
        .iter()
        .find(|c| c.eq_ignore_ascii_case(&name))
        .cloned()
        .or_else(|| (columns.len() == 1).then(|| columns[0].clone()))
        .unwrap_or(name);
    Some((column, values))
}

struct Extra {
    full_type: String,
    auto: bool,
    labels: Vec<String>,
}

async fn column_extras(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
) -> HashMap<String, Extra> {
    let lit = |text: &str| super::quote_literal(text);
    let sql = match kind {
        DatabaseKind::Postgres => format!(
            "SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS full_type, \
             (a.attidentity <> '' OR a.attgenerated <> '' OR COALESCE(pg_get_expr(d.adbin, d.adrelid), '') LIKE 'nextval(%') AS auto, \
             COALESCE((SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = a.atttypid), '[]'::json) AS labels \
             FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE a.attrelid = to_regclass({}) AND a.attnum > 0 AND NOT a.attisdropped",
            lit(&format!("{}.{}", super::quote_ident(schema), super::quote_ident(table)))
        ),
        DatabaseKind::Mysql => format!(
            "SELECT column_name AS name, column_type AS full_type, \
             (extra LIKE '%auto_increment%' OR extra LIKE '%GENERATED%') AS auto \
             FROM information_schema.columns WHERE table_schema = {} AND table_name = {}",
            super::mysql::lit(schema),
            super::mysql::lit(table)
        ),
        DatabaseKind::Mssql => format!(
            "SELECT c.name AS name, CASE WHEN t.name IN ('decimal', 'numeric') THEN CONCAT(t.name, '(', c.precision, ',', c.scale, ')') ELSE t.name END AS full_type, \
             CAST(CASE WHEN c.is_identity = 1 OR c.is_computed = 1 OR t.name IN ('timestamp', 'rowversion') THEN 1 ELSE 0 END AS int) AS auto \
             FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id \
             WHERE c.object_id = OBJECT_ID({})",
            super::mssql::lit(&qualified(kind, schema, table))
        ),
        DatabaseKind::Oracle => format!(
            "SELECT column_name AS \"name\", \
             CASE WHEN data_type = 'NUMBER' AND data_precision IS NOT NULL THEN 'NUMBER(' || data_precision || ',' || NVL(data_scale, 0) || ')' ELSE data_type END AS \"full_type\", \
             CASE WHEN identity_column = 'YES' OR virtual_column = 'YES' THEN 1 ELSE 0 END AS \"auto\" \
             FROM all_tab_cols WHERE owner = {} AND table_name = {} AND hidden_column = 'NO'",
            lit(schema),
            lit(table)
        ),
        DatabaseKind::Sqlite => format!(
            "SELECT name, type AS full_type, \
             (hidden IN (2, 3) OR (pk = 1 AND upper(type) = 'INTEGER' AND (SELECT count(*) FROM pragma_table_xinfo({t}, {s}) WHERE pk > 0) = 1)) AS auto \
             FROM pragma_table_xinfo({t}, {s})",
            t = lit(table),
            s = lit(if schema.is_empty() { "main" } else { schema })
        ),
        _ => return HashMap::new(),
    };
    let Ok(result) = adapter.execute_query(&sql).await else {
        return HashMap::new();
    };
    result
        .rows
        .iter()
        .map(|row| {
            let labels = match cell(row, "labels") {
                Some(Value::Array(items)) => items
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect(),
                Some(Value::String(text)) => {
                    serde_json::from_str::<Vec<String>>(text).unwrap_or_default()
                }
                _ => Vec::new(),
            };
            let full_type = cell_text(row, "full_type");
            let labels = if labels.is_empty() {
                enum_from_type(&full_type)
            } else {
                labels
            };
            (
                cell_text(row, "name"),
                Extra {
                    full_type,
                    auto: cell_flag(row, "auto"),
                    labels,
                },
            )
        })
        .collect()
}

pub async fn plan(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
) -> Result<DatagenPlan, String> {
    if !supported(kind) {
        return Err("Testdaten werden für diesen Datenbanktyp nicht unterstützt.".into());
    }
    let details = adapter.list_table_columns_detailed(schema, table).await?;
    let extras = column_extras(adapter, kind, schema, table).await;
    let constraints = if kind == DatabaseKind::Mongodb {
        Vec::new()
    } else {
        adapter
            .list_constraints(schema, table)
            .await
            .unwrap_or_default()
    };
    let foreign_keys = if kind == DatabaseKind::Mongodb {
        Vec::new()
    } else {
        adapter
            .list_foreign_keys(schema, table)
            .await
            .unwrap_or_default()
    };
    let mut checks: HashMap<String, Vec<String>> = HashMap::new();
    let mut unique: Vec<Vec<String>> = Vec::new();
    for constraint in &constraints {
        let kind_name = constraint.constraint_type.to_uppercase();
        if kind_name.contains("CHECK") {
            if let Some((column, values)) =
                enum_from_check(&constraint.definition, &constraint.columns)
            {
                checks.insert(column.to_lowercase(), values);
            }
        } else if (kind_name.contains("PRIMARY") || kind_name.contains("UNIQUE"))
            && !constraint.columns.is_empty()
            && !unique.contains(&constraint.columns)
        {
            unique.push(constraint.columns.clone());
        }
    }
    if kind == DatabaseKind::Sqlite {
        let names: Vec<String> = details.iter().map(|d| d.name.clone()).collect();
        let sql = format!(
            "SELECT sql FROM {}.sqlite_master WHERE name = {}",
            super::quote_ident(if schema.is_empty() { "main" } else { schema }),
            super::quote_literal(table)
        );
        if let Ok(result) = adapter.execute_query(&sql).await {
            let ddl = result.rows.first().map(|row| cell_text(row, "sql"));
            let ddl = ddl.unwrap_or_default();
            let upper = ddl.to_uppercase();
            for (index, _) in upper.match_indices("CHECK") {
                if let Some((column, values)) = enum_from_check(&ddl[index + 5..], &names) {
                    checks.entry(column.to_lowercase()).or_insert(values);
                }
            }
        }
    }
    let mut columns = Vec::new();
    for detail in details {
        let extra = extras.get(&detail.name);
        let full_type = extra
            .map(|e| e.full_type.clone())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| detail.data_type.clone());
        let max_length = detail
            .character_maximum_length
            .filter(|len| *len > 0)
            .map(|len| len as u32)
            .or_else(|| {
                (category(&full_type) == Category::Text)
                    .then(|| type_args(&full_type).first().copied())
                    .flatten()
                    .filter(|len| *len > 0)
                    .map(|len| len as u32)
            });
        let mut enum_values = extra.map(|e| e.labels.clone()).unwrap_or_default();
        if enum_values.is_empty() {
            enum_values = checks
                .get(&detail.name.to_lowercase())
                .cloned()
                .unwrap_or_default();
        }
        let fk = foreign_keys.iter().find(|fk| {
            fk.from_column == detail.name
                && fk.from_table.eq_ignore_ascii_case(table)
                && (fk.from_schema.is_empty() || fk.from_schema.eq_ignore_ascii_case(schema))
        });
        let auto = extra.is_some_and(|e| e.auto)
            || (kind == DatabaseKind::Mongodb && detail.name == "_id");
        let mut note = None;
        let generator = if auto {
            note = Some("Automatisch (Identity/Default)".into());
            Generator::Skip
        } else if let Some(fk) = fk {
            note = Some(format!("Fremdschlüssel → {}.{}", fk.to_table, fk.to_column));
            Generator::Reference {
                schema: fk.to_schema.clone(),
                table: fk.to_table.clone(),
                column: fk.to_column.clone(),
            }
        } else if !enum_values.is_empty() {
            Generator::List {
                values: enum_values.clone(),
            }
        } else if detail.is_primary_key && category(&full_type) == Category::Int {
            let start = max_value(adapter, kind, schema, table, &detail.name)
                .await
                .map(|max| max + 1)
                .unwrap_or(1);
            Generator::Sequence { start, step: 1 }
        } else {
            let generator = infer(&detail.name, &full_type, kind, max_length);
            if category(&full_type) == Category::Binary {
                note = Some("Binärtyp wird nicht generiert".into());
                if detail.is_nullable {
                    Generator::Null
                } else {
                    Generator::Skip
                }
            } else {
                generator
            }
        };
        if detail.column_default.is_some() && generator == Generator::Skip && note.is_none() {
            note = Some("Standardwert".into());
        }
        columns.push(ColumnPlan {
            name: detail.name,
            data_type: full_type,
            nullable: detail.is_nullable,
            max_length,
            generator,
            null_ratio: 0.0,
            enum_values,
            note,
        });
    }
    Ok(DatagenPlan { columns, unique })
}

async fn max_value(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &str,
) -> Option<i64> {
    let sql = format!(
        "SELECT MAX({}) AS {} FROM {}",
        quote(kind, column),
        quote(kind, "m"),
        qualified(kind, schema, table)
    );
    let result = adapter.execute_query(&sql).await.ok()?;
    let row = result.rows.first()?;
    match cell(row, "m")? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub fn reference_sql(kind: DatabaseKind, schema: &str, table: &str, column: &str) -> String {
    let c = quote(kind, column);
    let alias = quote(kind, "v");
    let t = qualified(kind, schema, table);
    match kind {
        DatabaseKind::Mssql => format!(
            "SELECT DISTINCT TOP {REFERENCE_SAMPLE} {c} AS {alias} FROM {t} WHERE {c} IS NOT NULL"
        ),
        DatabaseKind::Oracle => format!(
            "SELECT DISTINCT {c} AS {alias} FROM {t} WHERE {c} IS NOT NULL FETCH FIRST {REFERENCE_SAMPLE} ROWS ONLY"
        ),
        _ => format!(
            "SELECT DISTINCT {c} AS {alias} FROM {t} WHERE {c} IS NOT NULL LIMIT {REFERENCE_SAMPLE}"
        ),
    }
}

pub async fn context(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    request: &DatagenRequest,
) -> Result<Context, String> {
    let mut references = HashMap::new();
    for column in &request.columns {
        if let Generator::Reference {
            schema,
            table,
            column: parent,
        } = &column.generator
        {
            let key = reference_key(schema, table, parent);
            if references.contains_key(&key) {
                continue;
            }
            let result = adapter
                .execute_query(&reference_sql(kind, schema, table, parent))
                .await
                .map_err(|e| format!("Elternschlüssel aus {table} lesen: {e}"))?;
            let mut keys: Vec<Value> = result
                .rows
                .iter()
                .filter_map(|row| cell(row, "v").cloned())
                .filter(|v| !v.is_null())
                .collect();
            keys.sort_by_key(|v| v.to_string());
            references.insert(key, keys);
        }
    }
    Ok(Context {
        locale: request.locale,
        references,
    })
}

pub fn validate(kind: DatabaseKind, request: &DatagenRequest) -> Result<(), String> {
    if !supported(kind) {
        return Err("Testdaten werden für diesen Datenbanktyp nicht unterstützt.".into());
    }
    if request.rows == 0 || request.rows > MAX_ROWS {
        return Err(format!("Zeilenzahl muss zwischen 1 und {MAX_ROWS} liegen."));
    }
    for column in &request.columns {
        if !(0.0..=1.0).contains(&column.null_ratio) {
            return Err(format!(
                "NULL-Anteil für {} muss 0–100 % sein.",
                column.name
            ));
        }
        if !column.nullable && column.null_ratio > 0.0 {
            return Err(format!(
                "Spalte {} ist NOT NULL, NULL-Anteil nicht möglich.",
                column.name
            ));
        }
        if let Generator::Sql { expression } = &column.generator {
            if expression.contains(';') {
                return Err(format!(
                    "SQL-Ausdruck für {} darf kein Semikolon enthalten.",
                    column.name
                ));
            }
        }
    }
    Ok(())
}

enum RowSource {
    Generated(Box<RowFactory>),
    Copy {
        columns: Vec<ColumnPlan>,
        source: MaskedCopy,
        order_by: Option<String>,
    },
}

impl RowSource {
    async fn new(
        adapter: &dyn DatabaseAdapter,
        kind: DatabaseKind,
        request: &DatagenRequest,
    ) -> Result<Self, String> {
        let Some(source) = &request.source else {
            let ctx = context(adapter, kind, request).await?;
            return Ok(Self::Generated(Box::new(RowFactory::new(request, ctx)?)));
        };
        let columns: Vec<ColumnPlan> = request
            .columns
            .iter()
            .filter(|c| c.generator != Generator::Skip)
            .cloned()
            .collect();
        if columns.is_empty() {
            return Err("Keine Spalte zum Kopieren ausgewählt.".into());
        }
        for mask in &source.masks {
            if mask.mode == super::masking::MaskMode::Null
                && columns.iter().any(|c| c.name == mask.column && !c.nullable)
            {
                return Err(format!(
                    "Spalte {} ist NOT NULL und kann nicht auf NULL maskiert werden.",
                    mask.column
                ));
            }
        }
        let order_by = request
            .unique
            .first()
            .and_then(|set| set.first())
            .filter(|name| columns.iter().any(|c| &c.name == *name))
            .cloned();
        Ok(Self::Copy {
            columns,
            source: source.clone(),
            order_by,
        })
    }

    fn columns(&self) -> &[ColumnPlan] {
        match self {
            Self::Generated(factory) => factory.columns(),
            Self::Copy { columns, .. } => columns,
        }
    }

    async fn batch(
        &mut self,
        adapter: &dyn DatabaseAdapter,
        start: u64,
        end: u64,
    ) -> Result<Vec<Vec<Val>>, String> {
        match self {
            Self::Generated(factory) => (start..end).map(|index| factory.row(index)).collect(),
            Self::Copy {
                columns,
                source,
                order_by,
            } => {
                let data = adapter
                    .fetch_rows(
                        &source.schema,
                        &source.table,
                        None,
                        (end - start) as i64,
                        start as i64,
                        order_by.as_deref(),
                        false,
                        false,
                        false,
                    )
                    .await?;
                Ok(mask_rows(columns, data.rows, &source.masks, start))
            }
        }
    }
}

pub fn mask_rows(
    columns: &[ColumnPlan],
    mut rows: Vec<Value>,
    masks: &[super::export::ColumnMask],
    batch: u64,
) -> Vec<Vec<Val>> {
    use super::masking::{mask_value, shuffle_column, MaskMode};
    for mask in masks.iter().filter(|mask| mask.mode == MaskMode::Shuffle) {
        shuffle_column(&mut rows, &mask.column, batch);
    }
    rows.iter()
        .map(|row| {
            columns
                .iter()
                .map(|column| {
                    let cat = category(&column.data_type);
                    let value = cell(row, &column.name).cloned().unwrap_or(Value::Null);
                    match masks
                        .iter()
                        .find(|mask| mask.column == column.name && mask.mode != MaskMode::Shuffle)
                    {
                        Some(mask) => {
                            match mask_value(&column.name, &value, mask.mode, mask.text.as_deref())
                            {
                                Some(text) => typed(&text, cat),
                                None => Val::Null,
                            }
                        }
                        None => from_json(&value, cat),
                    }
                })
                .collect()
        })
        .collect()
}

pub async fn preview(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    request: &DatagenRequest,
) -> Result<DatagenPreview, String> {
    let mut request = request.clone();
    request.rows = request.rows.clamp(1, MAX_ROWS);
    validate(kind, &request)?;
    let mut source = RowSource::new(adapter, kind, &request).await?;
    let rows = source
        .batch(adapter, 0, request.rows.min(PREVIEW_ROWS))
        .await?;
    let columns: Vec<String> = source.columns().iter().map(|c| c.name.clone()).collect();
    let statement = if rows.is_empty() {
        String::new()
    } else {
        insert_statement(
            kind,
            &request.schema,
            &request.table,
            source.columns(),
            &rows[..rows.len().min(3)],
        )?
    };
    Ok(DatagenPreview {
        rows: rows
            .iter()
            .map(|row| {
                Value::Object(
                    columns
                        .iter()
                        .zip(row)
                        .map(|(name, value)| (name.clone(), json_value(value, false)))
                        .collect(),
                )
            })
            .collect(),
        columns,
        statement,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    request: &DatagenRequest,
    pool: &PoolState,
    transactions: &TransactionState,
) -> Result<DatagenOutcome, String> {
    validate(kind, request)?;
    let mut source = RowSource::new(adapter, kind, request).await?;
    let batch = batch_limit(kind, request.batch_size) as u64;
    let tx_id = if request.transaction && kind != DatabaseKind::Mongodb {
        Some(
            transactions
                .begin(kind, connection_string, database, pool)
                .await?,
        )
    } else {
        None
    };
    let token = super::execution::cancellation_token();
    let mut inserted = 0u64;
    let mut error = None;
    let mut next = 0u64;
    while next < request.rows {
        if token.is_cancelled() {
            break;
        }
        let end = (next + batch).min(request.rows);
        let requested = end - next;
        let rows = match source.batch(adapter, next, end).await {
            Ok(rows) if rows.is_empty() => break,
            Ok(rows) => rows,
            Err(e) => {
                error = Some(e);
                break;
            }
        };
        let count = rows.len() as u64;
        let sql = match insert_statement(
            kind,
            &request.schema,
            &request.table,
            source.columns(),
            &rows,
        ) {
            Ok(sql) => sql,
            Err(e) => {
                error = Some(e);
                break;
            }
        };
        let result = match &tx_id {
            Some(id) => transactions.execute(id, &sql).await,
            None => adapter.execute_query(&sql).await,
        };
        if let Err(e) = result {
            error = Some(format!("Zeile {}–{}: {e}", next + 1, next + count));
            break;
        }
        inserted += count;
        next += count;
        super::execution::progress(inserted);
        if count < requested {
            break;
        }
    }
    let cancelled = token.is_cancelled();
    if cancelled {
        error = None;
    }
    let Some(id) = tx_id else {
        return Ok(DatagenOutcome {
            inserted,
            cancelled,
            committed: inserted > 0,
            error,
        });
    };
    if cancelled || error.is_some() {
        let _ = transactions.rollback(&id).await;
        return Ok(DatagenOutcome {
            inserted: 0,
            cancelled,
            committed: false,
            error,
        });
    }
    if let Err(e) = transactions.commit(&id).await {
        let _ = transactions.rollback(&id).await;
        return Ok(DatagenOutcome {
            inserted: 0,
            cancelled: false,
            committed: false,
            error: Some(e),
        });
    }
    Ok(DatagenOutcome {
        inserted,
        cancelled: false,
        committed: true,
        error: None,
    })
}

fn scoped_database(kind: DatabaseKind, database: Option<String>, schema: &str) -> Option<String> {
    if kind == DatabaseKind::Mongodb && !schema.is_empty() {
        Some(schema.to_string())
    } else {
        database
    }
}

#[tauri::command]
pub async fn datagen_plan(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<DatagenPlan, String> {
    let database = scoped_database(kind, database, &schema);
    let adapter = super::create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?;
    plan(adapter.as_ref(), kind, &schema, &table).await
}

#[tauri::command]
pub async fn datagen_preview(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: DatagenRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<DatagenPreview, String> {
    let database = scoped_database(kind, database, &request.schema);
    let adapter = super::create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?;
    preview(adapter.as_ref(), kind, &request).await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn datagen_run(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: DatagenRequest,
    app: tauri::AppHandle,
    options: Option<super::execution::ExecutionOptions>,
    pool_state: tauri::State<'_, PoolState>,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<DatagenOutcome, String> {
    use tauri::Emitter;
    if super::connection::connection_string_is_read_only(&connection_string) {
        return Err("Lesemodus: Testdaten können nicht geschrieben werden.".into());
    }
    let database = scoped_database(kind, database, &request.schema);
    let job_id = options.as_ref().and_then(|options| options.job_id.clone());
    let pool = pool_state.inner().clone();
    let transactions = tx_state.inner().clone();
    super::execution::with_progress(
        move |rows| {
            let _ = app.emit("datagen-progress", json!({ "jobId": job_id, "rows": rows }));
        },
        super::execution::run(options, true, async {
            let adapter = super::create_adapter_from_string(
                kind,
                &connection_string,
                database.as_deref(),
                pool.clone(),
            )?;
            run(
                adapter.as_ref(),
                kind,
                &connection_string,
                database.as_deref(),
                &request,
                &pool,
                &transactions,
            )
            .await
        }),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str, generator: Generator) -> ColumnPlan {
        ColumnPlan {
            name: name.into(),
            data_type: data_type.into(),
            nullable: false,
            max_length: None,
            generator,
            null_ratio: 0.0,
            enum_values: Vec::new(),
            note: None,
        }
    }

    fn request(columns: Vec<ColumnPlan>, unique: Vec<Vec<String>>) -> DatagenRequest {
        DatagenRequest {
            schema: "public".into(),
            table: "people".into(),
            rows: 100,
            batch_size: 50,
            seed: 42,
            locale: Locale::De,
            transaction: true,
            columns,
            unique,
            source: None,
        }
    }

    fn ctx() -> Context {
        Context {
            locale: Locale::De,
            references: HashMap::new(),
        }
    }

    #[test]
    fn infers_generators_from_names_and_types() {
        let pg = DatabaseKind::Postgres;
        assert_eq!(
            infer("email", "varchar(255)", pg, Some(255)),
            Generator::Email
        );
        assert_eq!(infer("Vorname", "text", pg, None), Generator::FirstName);
        assert_eq!(infer("last_name", "text", pg, None), Generator::LastName);
        assert_eq!(infer("iban", "text", pg, None), Generator::Iban);
        assert_eq!(infer("city", "text", pg, None), Generator::City);
        assert_eq!(infer("phone", "text", pg, None), Generator::Phone);
        assert_eq!(infer("ip", "inet", pg, None), Generator::Ip);
        assert_eq!(infer("id", "uuid", pg, None), Generator::Uuid);
        assert_eq!(infer("active", "boolean", pg, None), Generator::Boolean);
        assert!(matches!(
            infer("created_at", "timestamp", pg, None),
            Generator::Timestamp { .. }
        ));
        assert!(matches!(
            infer("price", "numeric(6,2)", pg, None),
            Generator::Decimal { max, scale: 2, .. } if max == 1000.0
        ));
        assert!(matches!(
            infer("total", "numeric(4,2)", pg, None),
            Generator::Decimal { max, .. } if max == 99.0
        ));
        assert!(matches!(
            infer("level", "tinyint", DatabaseKind::Mysql, None),
            Generator::Integer { max: 127, .. }
        ));
        assert!(matches!(
            infer("description", "varchar(50)", pg, Some(50)),
            Generator::Lorem { max: 50, .. }
        ));
        assert_eq!(infer("payload", "jsonb", pg, None), Generator::Json);
    }

    #[test]
    fn generation_is_deterministic_per_seed() {
        let columns = vec![
            column("email", "text", Generator::Email),
            column("name", "text", Generator::FullName),
            column(
                "born",
                "date",
                Generator::Date {
                    from: "1950-01-01".into(),
                    to: "2000-12-31".into(),
                },
            ),
        ];
        let mut a = RowFactory::new(&request(columns.clone(), vec![]), ctx()).unwrap();
        let mut b = RowFactory::new(&request(columns.clone(), vec![]), ctx()).unwrap();
        for i in 0..20 {
            assert_eq!(a.row(i).unwrap(), b.row(i).unwrap());
        }
        let mut other = request(columns, vec![]);
        other.seed = 7;
        let mut c = RowFactory::new(&other, ctx()).unwrap();
        assert_ne!(a.row(50).unwrap(), c.row(50).unwrap());
    }

    #[test]
    fn unique_sets_are_deduplicated() {
        let list = |n: usize| {
            vec![column(
                "code",
                "text",
                Generator::List {
                    values: (0..n).map(|i| i.to_string()).collect(),
                },
            )]
        };
        let mut factory =
            RowFactory::new(&request(list(200), vec![vec!["code".into()]]), ctx()).unwrap();
        let mut seen = HashSet::new();
        for i in 0..30 {
            assert!(seen.insert(format!("{:?}", factory.row(i).unwrap())));
        }
        let mut small =
            RowFactory::new(&request(list(3), vec![vec!["code".into()]]), ctx()).unwrap();
        for i in 0..3 {
            small.row(i).unwrap();
        }
        assert!(small.row(3).is_err());
    }

    #[test]
    fn respects_length_nulls_and_not_null() {
        let mut short = column("title", "varchar(5)", Generator::Lorem { min: 20, max: 40 });
        short.max_length = Some(5);
        let mut nullable = column("note", "text", Generator::FirstName);
        nullable.nullable = true;
        nullable.null_ratio = 1.0;
        let mut factory = RowFactory::new(&request(vec![short, nullable], vec![]), ctx()).unwrap();
        let row = factory.row(0).unwrap();
        assert!(matches!(&row[0], Val::Text(t) if t.chars().count() <= 5));
        assert_eq!(row[1], Val::Null);
        let bad = column("x", "text", Generator::Null);
        assert!(RowFactory::new(&request(vec![bad], vec![]), ctx()).is_err());
        let mut ratio = column("y", "text", Generator::FirstName);
        ratio.null_ratio = 0.5;
        assert!(validate(DatabaseKind::Postgres, &request(vec![ratio], vec![])).is_err());
    }

    #[test]
    fn references_sample_parent_keys() {
        let mut ctx = ctx();
        ctx.references.insert(
            reference_key("public", "orgs", "id"),
            vec![json!(3), json!(9)],
        );
        let columns = vec![column(
            "org_id",
            "integer",
            Generator::Reference {
                schema: "public".into(),
                table: "orgs".into(),
                column: "id".into(),
            },
        )];
        let mut factory = RowFactory::new(&request(columns, vec![]), ctx).unwrap();
        for i in 0..20 {
            let row = factory.row(i).unwrap();
            assert!(row[0] == Val::Int(3) || row[0] == Val::Int(9));
        }
    }

    #[test]
    fn iban_checksum_is_valid() {
        let mut rng = Rng::new(1);
        for _ in 0..20 {
            let value = iban(&mut rng);
            let rearranged = format!("{}{}", &value[4..], "1314") + &value[2..4];
            assert_eq!(mod97(&rearranged), 1, "{value}");
            assert_eq!(value.len(), 22);
        }
    }

    #[test]
    fn dialect_specific_insert_statements() {
        let columns = vec![
            column("name", "text", Generator::FirstName),
            column("active", "boolean", Generator::Boolean),
            column(
                "at",
                "timestamp",
                Generator::Timestamp {
                    from: "2020-01-01".into(),
                    to: "2020-01-02".into(),
                },
            ),
        ];
        let rows = vec![
            vec![
                Val::Text("O'Neil".into()),
                Val::Bool(true),
                Val::Timestamp("2020-01-01 10:00:00".into()),
            ],
            vec![Val::Text("a\\b".into()), Val::Bool(false), Val::Null],
        ];
        let pg = insert_statement(DatabaseKind::Postgres, "public", "t", &columns, &rows).unwrap();
        assert_eq!(
            pg,
            "INSERT INTO \"public\".\"t\" (\"name\", \"active\", \"at\") VALUES ('O''Neil', TRUE, '2020-01-01 10:00:00'), ('a\\b', FALSE, NULL)"
        );
        let my = insert_statement(DatabaseKind::Mysql, "app", "t", &columns, &rows).unwrap();
        assert!(my.starts_with("INSERT INTO `app`.`t` (`name`, `active`, `at`) VALUES"));
        assert!(my.contains("'a\\\\b'"));
        let ms = insert_statement(DatabaseKind::Mssql, "dbo", "t", &columns, &rows).unwrap();
        assert!(ms.contains("(N'O''Neil', 1, N'2020-01-01T10:00:00')"));
        let ora = insert_statement(DatabaseKind::Oracle, "APP", "T", &columns, &rows).unwrap();
        assert!(ora.starts_with("INSERT ALL INTO \"APP\".\"T\""));
        assert!(ora.contains("TIMESTAMP '2020-01-01 10:00:00'"));
        assert!(ora.ends_with("SELECT 1 FROM DUAL"));
        let lite = insert_statement(DatabaseKind::Sqlite, "main", "t", &columns, &rows).unwrap();
        assert!(lite.contains("('O''Neil', 1, '2020-01-01 10:00:00')"));
        let mongo =
            insert_statement(DatabaseKind::Mongodb, "db", "people", &columns, &rows).unwrap();
        let parsed: Value = serde_json::from_str(&mongo).unwrap();
        assert_eq!(parsed["insert"], "people");
        assert_eq!(
            parsed["documents"][0]["at"]["$date"],
            "2020-01-01T10:00:00Z"
        );
        assert_eq!(parsed["documents"][1]["active"], false);
    }

    #[test]
    fn parses_enum_types_and_check_constraints() {
        assert_eq!(enum_from_type("enum('a','b''c')"), vec!["a", "b'c"]);
        let pg = enum_from_check(
            "CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))",
            &["status".into()],
        )
        .unwrap();
        assert_eq!(pg, ("status".into(), vec!["open".into(), "closed".into()]));
        let ora = enum_from_check("\"STATE\" IN ('A','B')", &["STATE".into()]).unwrap();
        assert_eq!(ora.1, vec!["A", "B"]);
        let ms = enum_from_check("([kind]='x' OR [kind]='y')", &["kind".into()]);
        assert!(ms.is_none());
    }

    #[test]
    fn pattern_and_sequence() {
        let mut rng = Rng::new(3);
        let value = pattern(&mut rng, "AB-###-??-%\\#", 4);
        assert!(value.starts_with("AB-"));
        assert!(value.ends_with("-5#"));
        let seq = column("id", "integer", Generator::Sequence { start: 10, step: 5 });
        let mut factory =
            RowFactory::new(&request(vec![seq], vec![vec!["id".into()]]), ctx()).unwrap();
        assert_eq!(factory.row(0).unwrap(), vec![Val::Int(10)]);
        assert_eq!(factory.row(3).unwrap(), vec![Val::Int(25)]);
    }

    #[test]
    fn masked_copy_applies_masks() {
        use crate::db::export::ColumnMask;
        use crate::db::masking::MaskMode;
        let mut id = column("id", "integer", Generator::Skip);
        id.generator = Generator::Integer { min: 0, max: 0 };
        let mut note = column("note", "text", Generator::Lorem { min: 1, max: 2 });
        note.nullable = true;
        let columns = vec![
            id,
            column("email", "text", Generator::Email),
            column("name", "text", Generator::FullName),
            note,
        ];
        let rows: Vec<Value> = (0..4)
            .map(|i| json!({"id": i, "email": format!("user{i}@firma.de"), "name": format!("Name {i}"), "note": "geheim"}))
            .collect();
        let masks = vec![
            ColumnMask {
                column: "email".into(),
                mode: MaskMode::Partial,
                text: None,
            },
            ColumnMask {
                column: "name".into(),
                mode: MaskMode::Hash,
                text: None,
            },
            ColumnMask {
                column: "note".into(),
                mode: MaskMode::Null,
                text: None,
            },
            ColumnMask {
                column: "id".into(),
                mode: MaskMode::Shuffle,
                text: None,
            },
        ];
        let out = mask_rows(&columns, rows, &masks, 0);
        assert_eq!(out.len(), 4);
        assert_eq!(out[0][1], Val::Text("u***@firma.de".into()));
        assert!(matches!(&out[0][2], Val::Text(h) if h.len() == 16));
        assert_eq!(out[0][3], Val::Null);
        let mut ids: Vec<Val> = out.iter().map(|r| r[0].clone()).collect();
        ids.sort_by_key(|v| format!("{v:?}"));
        assert_eq!(ids, (0..4).map(Val::Int).collect::<Vec<_>>());
    }

    #[test]
    fn fake_values_are_stable() {
        assert_eq!(fake_for_column("email", 99), fake_for_column("email", 99));
        assert!(fake_for_column("email", 99).contains('@'));
    }

    async fn plan_for(adapter: &dyn DatabaseAdapter, table: &str) -> DatagenPlan {
        plan(adapter, DatabaseKind::Sqlite, "main", table)
            .await
            .unwrap()
    }

    fn cell(row: &Value, key: &str) -> String {
        row[key].to_string().trim_matches('"').to_string()
    }

    #[tokio::test]
    async fn sqlite_generates_and_copies_end_to_end() {
        use crate::db::pool::create_pool_state;
        use crate::db::transaction::create_transaction_state;
        let path = std::env::temp_dir().join(format!("l8db-datagen-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let url = format!("sqlite://{}", path.display());
        let pool = create_pool_state();
        let adapter = super::super::create_adapter_from_string(
            DatabaseKind::Sqlite,
            &url,
            None,
            pool.clone(),
        )
        .unwrap();
        for sql in [
            "CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name VARCHAR(5) NOT NULL)",
            "INSERT INTO customers (id, email, name) VALUES (7, 'anna@firma.de', 'Anna'), (9, 'carl@firma.de', 'Carl')",
            "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), status TEXT CHECK (status IN ('neu','bezahlt')), total NUMERIC(8,2))",
            "CREATE TABLE customers_copy (id INTEGER PRIMARY KEY, email TEXT, name TEXT)",
        ] {
            adapter.execute_query(sql).await.unwrap();
        }
        let transactions = create_transaction_state();
        let orders = plan_for(adapter.as_ref(), "orders").await;
        let request: DatagenRequest = serde_json::from_value(json!({
            "schema": "main",
            "table": "orders",
            "rows": 250,
            "batchSize": 100,
            "seed": 42,
            "locale": "de",
            "transaction": true,
            "columns": orders.columns,
            "unique": orders.unique,
        }))
        .unwrap();
        let first = preview(adapter.as_ref(), DatabaseKind::Sqlite, &request)
            .await
            .unwrap();
        let second = preview(adapter.as_ref(), DatabaseKind::Sqlite, &request)
            .await
            .unwrap();
        assert_eq!(first.rows.len(), 20);
        assert_eq!(first.rows, second.rows);
        let outcome = run(
            adapter.as_ref(),
            DatabaseKind::Sqlite,
            &url,
            None,
            &request,
            &pool,
            &transactions,
        )
        .await
        .unwrap();
        assert_eq!(outcome.inserted, 250, "{outcome:?} {}", first.statement);
        assert!(outcome.committed && outcome.error.is_none());
        let check = adapter
            .execute_query("SELECT COUNT(*) AS n, SUM(customer_id NOT IN (7, 9)) AS orphans, SUM(status NOT IN ('neu','bezahlt')) AS bad FROM orders")
            .await
            .unwrap();
        let row = &check.rows[0];
        assert_eq!(cell(row, "n"), "250");
        assert_eq!(cell(row, "orphans"), "0");
        assert_eq!(cell(row, "bad"), "0");

        let target = plan_for(adapter.as_ref(), "customers_copy").await;
        let copy: DatagenRequest = serde_json::from_value(json!({
            "schema": "main",
            "table": "customers_copy",
            "rows": 10,
            "batchSize": 1,
            "seed": 1,
            "locale": "de",
            "transaction": false,
            "columns": target.columns,
            "unique": [],
            "source": {
                "schema": "main",
                "table": "customers",
                "masks": [{"column": "email", "mode": "partial"}, {"column": "name", "mode": "null"}]
            }
        }))
        .unwrap();
        let copied = run(
            adapter.as_ref(),
            DatabaseKind::Sqlite,
            &url,
            None,
            &copy,
            &pool,
            &transactions,
        )
        .await
        .unwrap();
        assert_eq!(copied.inserted, 2, "{copied:?}");
        let rows = adapter
            .execute_query("SELECT email, name FROM customers_copy ORDER BY id")
            .await
            .unwrap()
            .rows;
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row["name"].is_null()));
        assert!(rows.iter().all(|row| cell(row, "email").contains("***")));
        assert!(rows.iter().all(|row| !cell(row, "email").contains("anna")));
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    #[ignore]
    async fn postgres_generates_end_to_end() {
        use crate::db::pool::create_pool_state;
        use crate::db::transaction::create_transaction_state;
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgres://postgres:testpw@127.0.0.1:5433/testdb".into());
        let pool = create_pool_state();
        let adapter = super::super::create_adapter_from_string(
            DatabaseKind::Postgres,
            &url,
            None,
            pool.clone(),
        )
        .unwrap();
        adapter
            .execute_query("DROP SCHEMA IF EXISTS l8db_datagen CASCADE; CREATE SCHEMA l8db_datagen; CREATE TYPE l8db_datagen.mood AS ENUM ('gut', 'schlecht'); CREATE TABLE l8db_datagen.customers (id serial PRIMARY KEY, email varchar(60) NOT NULL UNIQUE, name varchar(8) NOT NULL, mood l8db_datagen.mood, born date, created_at timestamptz NOT NULL, balance numeric(6,2), active boolean, meta jsonb, uid uuid); INSERT INTO l8db_datagen.customers (email, name, created_at) VALUES ('a@b.de', 'Anna', now()); CREATE TABLE l8db_datagen.orders (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, customer_id int NOT NULL REFERENCES l8db_datagen.customers(id), status text CHECK (status IN ('neu', 'bezahlt')), total numeric(8,2))")
            .await
            .unwrap();
        let transactions = create_transaction_state();
        for (table, rows) in [("customers", 300u64), ("orders", 500)] {
            let plan = plan(
                adapter.as_ref(),
                DatabaseKind::Postgres,
                "l8db_datagen",
                table,
            )
            .await
            .unwrap();
            let request: DatagenRequest = serde_json::from_value(json!({
                "schema": "l8db_datagen",
                "table": table,
                "rows": rows,
                "batchSize": 128,
                "seed": 7,
                "locale": "en",
                "transaction": table == "orders",
                "columns": plan.columns,
                "unique": plan.unique,
            }))
            .unwrap();
            let outcome = run(
                adapter.as_ref(),
                DatabaseKind::Postgres,
                &url,
                None,
                &request,
                &pool,
                &transactions,
            )
            .await
            .unwrap();
            assert_eq!(outcome.inserted, rows, "{table}: {outcome:?}");
        }
        let check = adapter
            .execute_query("SELECT (SELECT count(*) FROM l8db_datagen.customers) AS customers, (SELECT count(*) FROM l8db_datagen.orders o WHERE status NOT IN ('neu', 'bezahlt')) AS bad")
            .await
            .unwrap();
        assert_eq!(cell(&check.rows[0], "customers"), "301");
        assert_eq!(cell(&check.rows[0], "bad"), "0");
        adapter
            .execute_query("DROP SCHEMA l8db_datagen CASCADE")
            .await
            .unwrap();
    }
}
