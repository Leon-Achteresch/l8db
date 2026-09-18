use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use mongodb::bson::{doc, Bson, Document};
use serde_json::{json, Value};

pub fn to_command(input: &str) -> Option<Result<Document, String>> {
    let src = input.trim().trim_end_matches(';').trim_end();
    let rest = src.strip_prefix("db.")?;
    Some(parse_call_chain(rest).and_then(|(coll, calls)| build(&coll, calls)))
}

fn parse_call_chain(rest: &str) -> Result<(String, Vec<(String, Vec<Bson>)>), String> {
    let chars: Vec<char> = rest.chars().collect();
    let mut i = 0;
    let coll;
    if rest.starts_with("getCollection(") {
        let open = "getCollection".len();
        let close = matching(&chars, open)?;
        let args = parse_args(&chars[open + 1..close].iter().collect::<String>())?;
        coll = match args.first() {
            Some(Bson::String(s)) => s.clone(),
            _ => return Err("getCollection erwartet einen Namen".into()),
        };
        i = close + 1;
    } else {
        let start = i;
        while i < chars.len() && chars[i] != '(' {
            i += 1;
        }
        let path: String = chars[start..i].iter().collect();
        let dot = path
            .rfind('.')
            .ok_or("Erwartet db.<collection>.<methode>(...)")?;
        coll = path[..dot].to_string();
        i = start + path[..dot].chars().count();
    }
    let mut calls = Vec::new();
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        if chars[i] != '.' {
            return Err(format!("Unerwartetes Zeichen '{}'", chars[i]));
        }
        let start = i + 1;
        i = start;
        while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
            i += 1;
        }
        let name: String = chars[start..i].iter().collect();
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if chars.get(i) != Some(&'(') {
            return Err(format!("Erwartet '(' nach {name}"));
        }
        let close = matching(&chars, i)?;
        calls.push((
            name,
            parse_args(&chars[i + 1..close].iter().collect::<String>())?,
        ));
        i = close + 1;
    }
    if coll.is_empty() || calls.is_empty() {
        return Err("Erwartet db.<collection>.<methode>(...)".into());
    }
    Ok((coll, calls))
}

fn build(coll: &str, calls: Vec<(String, Vec<Bson>)>) -> Result<Document, String> {
    let mut calls = calls.into_iter();
    let (method, args) = calls.next().unwrap();
    let arg = |n: usize| args.get(n).cloned();
    let filter = || arg(0).unwrap_or(Bson::Document(Document::new()));
    let mut command = match method.as_str() {
        "find" | "findOne" => {
            let mut c = doc! { "find": coll, "filter": filter() };
            if let Some(p) = arg(1) {
                c.insert("projection", p);
            }
            if method == "findOne" {
                c.insert("limit", 1);
            }
            c
        }
        "aggregate" => {
            doc! { "aggregate": coll, "pipeline": arg(0).unwrap_or(Bson::Array(vec![])), "cursor": {} }
        }
        "countDocuments" | "count" => doc! {
            "aggregate": coll,
            "pipeline": [{ "$match": filter() }, { "$count": "count" }],
            "cursor": {},
        },
        "distinct" => {
            let mut c =
                doc! { "distinct": coll, "key": arg(0).ok_or("distinct erwartet ein Feld")? };
            if let Some(q) = arg(1) {
                c.insert("query", q);
            }
            c
        }
        "insertOne" => {
            doc! { "insert": coll, "documents": [arg(0).ok_or("insertOne erwartet ein Dokument")?] }
        }
        "insertMany" => {
            doc! { "insert": coll, "documents": arg(0).ok_or("insertMany erwartet ein Array")? }
        }
        "updateOne" | "updateMany" | "replaceOne" => {
            let mut update = doc! {
                "q": filter(),
                "u": arg(1).ok_or(format!("{method} erwartet ein Update"))?,
                "multi": method == "updateMany",
            };
            if let Some(Bson::Document(opts)) = arg(2) {
                update.extend(opts);
            }
            doc! { "update": coll, "updates": [update] }
        }
        "deleteOne" | "deleteMany" => doc! {
            "delete": coll,
            "deletes": [{ "q": filter(), "limit": if method == "deleteOne" { 1 } else { 0 } }],
        },
        "drop" => doc! { "drop": coll },
        _ => return Err(format!("Nicht unterstützte Methode: {method}")),
    };
    for (name, args) in calls {
        if !command.contains_key("find") {
            return Err(format!(".{name}() ist nur nach find() möglich"));
        }
        let value = args
            .into_iter()
            .next()
            .ok_or(format!(".{name}() erwartet ein Argument"))?;
        match name.as_str() {
            "sort" | "limit" | "skip" | "projection" | "hint" => {
                command.insert(name, value);
            }
            _ => return Err(format!("Nicht unterstützt: .{name}()")),
        }
    }
    Ok(command)
}

fn parse_args(src: &str) -> Result<Vec<Bson>, String> {
    let value: Value = serde_json::from_str(&js_to_json(&format!("[{src}]"))?)
        .map_err(|e| format!("Ungültige Argumente: {e}"))?;
    match Bson::try_from(value).map_err(|e| format!("Ungültige Argumente: {e}"))? {
        Bson::Array(values) => Ok(values),
        _ => unreachable!(),
    }
}

fn matching(chars: &[char], open: usize) -> Result<usize, String> {
    let mut depth = 0;
    let mut i = open;
    while i < chars.len() {
        match chars[i] {
            '"' | '\'' => i = skip_string(chars, i),
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    Err("Klammer nicht geschlossen".into())
}

fn skip_string(chars: &[char], start: usize) -> usize {
    let quote = chars[start];
    let mut i = start + 1;
    while i < chars.len() && chars[i] != quote {
        if chars[i] == '\\' {
            i += 1;
        }
        i += 1;
    }
    i
}

fn next_significant(chars: &[char], mut i: usize) -> Option<char> {
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    chars.get(i).copied()
}

fn js_to_json(src: &str) -> Result<String, String> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else if c == '"' || c == '\'' {
            let end = skip_string(&chars, i);
            let raw: String = chars[i + 1..end.min(chars.len())].iter().collect();
            let text = if c == '"' {
                serde_json::from_str::<String>(&format!("\"{raw}\"")).map_err(|e| e.to_string())?
            } else {
                raw.replace("\\'", "'")
            };
            out.push_str(&serde_json::to_string(&text).unwrap());
            i = end + 1;
        } else if c == ',' {
            if !matches!(next_significant(&chars, i + 1), Some('}' | ']')) {
                out.push(',');
            }
            i += 1;
        } else if c.is_ascii_digit() || c == '-' || c == '+' || c == '.' {
            let start = i;
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || matches!(chars[i], '.' | '+' | '-'))
            {
                i += 1;
            }
            out.extend(chars[start + usize::from(c == '+')..i].iter());
        } else if c.is_alphabetic() || c == '_' || c == '$' {
            let start = i;
            while i < chars.len()
                && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            if ident == "new" {
                continue;
            }
            match next_significant(&chars, i) {
                Some(':') => out.push_str(&serde_json::to_string(&ident).unwrap()),
                Some('(') => {
                    while chars[i] != '(' {
                        i += 1;
                    }
                    let close = matching(&chars, i)?;
                    let inner: String = chars[i + 1..close].iter().collect();
                    let args: Vec<Value> =
                        serde_json::from_str(&js_to_json(&format!("[{inner}]"))?)
                            .map_err(|e| format!("{ident}(): {e}"))?;
                    out.push_str(&constructor(&ident, args.first())?.to_string());
                    i = close + 1;
                }
                _ => out.push_str(match ident.as_str() {
                    "true" | "false" | "null" => &ident,
                    "undefined" => "null",
                    _ => return Err(format!("Unbekannter Bezeichner: {ident}")),
                }),
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    Ok(out)
}

fn constructor(name: &str, arg: Option<&Value>) -> Result<Value, String> {
    let text = arg.map(|v| {
        v.as_str()
            .map(str::to_string)
            .unwrap_or_else(|| v.to_string())
    });
    let need = || {
        text.clone()
            .ok_or(format!("{name}() erwartet ein Argument"))
    };
    Ok(match name {
        "ISODate" | "Date" => {
            let millis = match arg {
                None => Utc::now().timestamp_millis(),
                Some(Value::Number(n)) => n.as_i64().ok_or("Ungültiges Datum")?,
                Some(_) => parse_date(&need()?)?,
            };
            json!({ "$date": { "$numberLong": millis.to_string() } })
        }
        "ObjectId" => json!({ "$oid": need()? }),
        "NumberLong" | "Long" => json!({ "$numberLong": need()? }),
        "NumberInt" | "Int32" => json!({ "$numberInt": need()? }),
        "NumberDecimal" | "Decimal128" => json!({ "$numberDecimal": need()? }),
        _ => return Err(format!("Unbekannte Funktion: {name}()")),
    })
}

fn parse_date(s: &str) -> Result<i64, String> {
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Ok(d.timestamp_millis());
    }
    if let Ok(d) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
        return Ok(d.and_utc().timestamp_millis());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis())
        .map_err(|_| format!("Ungültiges Datum: {s}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_shell_aggregate() {
        let cmd = to_command(
            r#"db.orders.aggregate([
  { $match: { LAST_UPDATE: { $gte: ISODate("2026-09-16T22:00:00.000Z"), $lt: new Date('2026-09-17') } } },
  { $group: { _id: "$ORDNER_NO" } }, // comment
  { $count: "uniqueOrders" },
]);"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(cmd.get_str("aggregate").unwrap(), "orders");
        let pipeline = cmd.get_array("pipeline").unwrap();
        assert_eq!(pipeline.len(), 3);
        let range = pipeline[0]
            .as_document()
            .unwrap()
            .get_document("$match")
            .unwrap()
            .get_document("LAST_UPDATE")
            .unwrap();
        assert_eq!(
            range.get_datetime("$gte").unwrap().timestamp_millis(),
            1_789_596_000_000
        );
        assert!(range.get_datetime("$lt").is_ok());
    }

    #[test]
    fn translates_find_chain_and_writes() {
        let cmd = to_command(
            "db.getCollection('a.b').find({x: {$gt: -1.5}}, {x: 1}).sort({x: -1}).limit(5)",
        )
        .unwrap()
        .unwrap();
        assert_eq!(cmd.get_str("find").unwrap(), "a.b");
        assert_eq!(cmd.get_i32("limit").unwrap(), 5);
        let cmd =
            to_command("db.sys.users.deleteOne({_id: ObjectId(\"64b7f0000000000000000000\")})")
                .unwrap()
                .unwrap();
        assert_eq!(cmd.get_str("delete").unwrap(), "sys.users");
        assert!(to_command("{\"find\": \"x\"}").is_none());
        assert!(to_command("db.x.foo()").unwrap().is_err());
    }
}
