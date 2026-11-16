use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use mongodb::bson::{doc, Bson, Document};
use serde_json::{json, Value};

pub fn to_command(input: &str) -> Option<Result<Document, String>> {
    let src = skip_comments(input)
        .trim_end()
        .trim_end_matches(';')
        .trim_end();
    if src.starts_with('{') && src.len() != input.trim().len() {
        return Some(super::mongodb::parse_document(src, "Der Befehl"));
    }
    let rest = src.strip_prefix("db.")?;
    if let Some(inner) = rest.strip_prefix("runCommand") {
        return Some(run_command(inner.trim_start()));
    }
    Some(parse_call_chain(rest).and_then(|(coll, calls)| build(&coll, calls)))
}

pub fn split(input: &str) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '/' && matches!(chars.get(i + 1), Some('/' | '*')) {
            let end = comment_end(&chars, i);
            if depth > 0 {
                current.extend(&chars[i..end]);
            }
            i = end;
            continue;
        }
        let end = match c {
            '"' | '\'' => skip_string(&chars, i),
            '/' if regex_position(&current) => skip_regex(&chars, i),
            _ => i,
        };
        if end > i {
            current.extend(&chars[i..(end + 1).min(chars.len())]);
            i = end + 1;
            continue;
        }
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            _ => {}
        }
        let boundary = depth <= 0
            && (c == ';'
                || (c == '\n'
                    && !current.trim().is_empty()
                    && next_code(&chars, i + 1) != Some('.')));
        if boundary {
            if !current.trim().is_empty() {
                parts.push(current.trim().to_string());
            }
            current.clear();
            depth = 0;
        } else {
            current.push(c);
        }
        i += 1;
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn next_code(chars: &[char], mut i: usize) -> Option<char> {
    loop {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if chars.get(i) == Some(&'/') && matches!(chars.get(i + 1), Some('/' | '*')) {
            i = comment_end(chars, i);
        } else {
            return chars.get(i).copied();
        }
    }
}

fn comment_end(chars: &[char], start: usize) -> usize {
    let mut i = start + 2;
    if chars.get(start + 1) == Some(&'/') {
        while i < chars.len() && chars[i] != '\n' {
            i += 1;
        }
        return i;
    }
    while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
        i += 1;
    }
    (i + 2).min(chars.len())
}

fn skip_comments(input: &str) -> &str {
    let mut rest = input.trim_start();
    while rest.starts_with("//") || rest.starts_with("/*") {
        let chars: Vec<char> = rest.chars().collect();
        let end = comment_end(&chars, 0);
        let bytes: usize = chars[..end].iter().map(|c| c.len_utf8()).sum();
        rest = rest[bytes..].trim_start();
    }
    rest
}

fn regex_position(before: &str) -> bool {
    matches!(
        before.trim_end().chars().last(),
        None | Some(':' | ',' | '(' | '[' | '{')
    )
}

fn skip_regex(chars: &[char], start: usize) -> usize {
    let mut i = start + 1;
    let mut class = false;
    while i < chars.len() && chars[i] != '\n' {
        match chars[i] {
            '\\' => i += 1,
            '[' => class = true,
            ']' => class = false,
            '/' if !class => {
                while i + 1 < chars.len() && chars[i + 1].is_ascii_alphabetic() {
                    i += 1;
                }
                return i;
            }
            _ => {}
        }
        i += 1;
    }
    start
}

fn run_command(inner: &str) -> Result<Document, String> {
    let chars: Vec<char> = inner.chars().collect();
    if chars.first() != Some(&'(') {
        return Err("Erwartet db.runCommand({...})".into());
    }
    let close = matching(&chars, 0)?;
    if chars[close + 1..].iter().any(|c| !c.is_whitespace()) {
        return Err("Nach db.runCommand(...) ist nichts weiter möglich".into());
    }
    match parse_args(&chars[1..close].iter().collect::<String>())?
        .into_iter()
        .next()
    {
        Some(Bson::Document(command)) => Ok(command),
        _ => {
            Err("db.runCommand erwartet ein Befehlsdokument, z. B. db.runCommand({ping: 1})".into())
        }
    }
}

const SHAPE: &str = "Erwartet db.<collection>.<methode>(...) oder db.runCommand({...}); mehrere Anweisungen mit ; oder Zeilenumbruch trennen";

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
        let dot = path.rfind('.').ok_or(SHAPE)?;
        coll = path[..dot].to_string();
        i = start + path[..dot].chars().count();
    }
    let mut calls = Vec::new();
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        if chars[i] == '/' && matches!(chars.get(i + 1), Some('/' | '*')) {
            i = comment_end(&chars, i);
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
        return Err(SHAPE.into());
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
        "countDocuments" | "count" => count_command(coll, filter()),
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
        match name.as_str() {
            "pretty" | "toArray" => continue,
            "explain" => return Err("Nicht unterstützt: .explain(). Als Befehlsdokument: {\"explain\": {\"find\": \"users\", \"filter\": {}}}".into()),
            _ => {}
        }
        if !command.contains_key("find") {
            return Err(format!(".{name}() ist nur nach find() möglich"));
        }
        if name == "count" {
            let filter = command
                .get("filter")
                .cloned()
                .unwrap_or(Bson::Document(Document::new()));
            command = count_command(coll, filter);
            continue;
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

fn count_command(coll: &str, filter: Bson) -> Document {
    doc! {
        "aggregate": coll,
        "pipeline": [
            { "$match": filter },
            { "$facet": { "c": [{ "$count": "count" }] } },
            { "$project": { "count": { "$ifNull": [{ "$arrayElemAt": ["$c.count", 0] }, 0] } } },
        ],
        "cursor": {},
    }
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
    let mut prev = None;
    while i < chars.len() {
        let c = chars[i];
        if c == '/' && matches!(chars.get(i + 1), Some('/' | '*')) {
            i = comment_end(chars, i);
            continue;
        }
        match c {
            '"' | '\'' => i = skip_string(chars, i),
            '/' if matches!(prev, Some(':' | ',' | '(' | '[' | '{')) => i = skip_regex(chars, i),
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(i);
                }
            }
            _ => {}
        }
        if !c.is_whitespace() {
            prev = Some(c);
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
        } else if c == '/' && regex_position(&out) && skip_regex(&chars, i) > i {
            let end = skip_regex(&chars, i);
            let body: String = chars[i + 1..=end].iter().collect();
            let close = body.rfind('/').unwrap_or(body.len());
            let mut options: Vec<char> = body[close + 1..].chars().collect();
            options.sort_unstable();
            out.push_str(
                &json!({ "$regularExpression": {
                    "pattern": &body[..close],
                    "options": options.into_iter().collect::<String>(),
                } })
                .to_string(),
            );
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
            let token: String = chars[start + usize::from(c == '+')..i].iter().collect();
            match token.as_str() {
                "-Infinity" => out.push_str(r#"{"$numberDouble":"-Infinity"}"#),
                _ => out.push_str(&token),
            }
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
                    out.push_str(&constructor(&ident, &args)?.to_string());
                    i = close + 1;
                }
                _ => out.push_str(match ident.as_str() {
                    "true" | "false" | "null" => &ident,
                    "undefined" => "null",
                    "NaN" => r#"{"$numberDouble":"NaN"}"#,
                    "Infinity" => r#"{"$numberDouble":"Infinity"}"#,
                    "MinKey" => r#"{"$minKey":1}"#,
                    "MaxKey" => r#"{"$maxKey":1}"#,
                    _ => {
                        return Err(format!(
                            "Unbekannter Bezeichner: {ident}. Zeichenketten in Anführungszeichen setzen"
                        ))
                    }
                }),
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    Ok(out)
}

fn constructor(name: &str, args: &[Value]) -> Result<Value, String> {
    let arg = args.first();
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
        "Timestamp" => match (
            args.first().and_then(Value::as_u64),
            args.get(1).and_then(Value::as_u64),
        ) {
            (Some(t), Some(i)) => json!({ "$timestamp": { "t": t, "i": i } }),
            (None, None) if args.is_empty() => json!({ "$timestamp": { "t": 0, "i": 0 } }),
            _ => {
                return Err(
                    "Timestamp() erwartet zwei Zahlen, z. B. Timestamp(1700000000, 1)".into(),
                )
            }
        },
        "BinData" => match (
            args.first().and_then(Value::as_u64),
            args.get(1).and_then(Value::as_str),
        ) {
            (Some(subtype), Some(base64)) if subtype < 256 => {
                json!({ "$binary": { "base64": base64, "subType": format!("{subtype:02x}") } })
            }
            _ => {
                return Err(
                    "BinData() erwartet Subtyp und Base64, z. B. BinData(0, \"AAECAw==\")".into(),
                )
            }
        },
        "UUID" => {
            let uuid = match arg {
                None => mongodb::bson::Uuid::new(),
                Some(_) => mongodb::bson::Uuid::parse_str(need()?)
                    .map_err(|_| format!("Ungültige UUID: {}", text.clone().unwrap_or_default()))?,
            };
            Bson::Binary(mongodb::bson::Binary::from_uuid(uuid)).into_canonical_extjson()
        }
        "MinKey" => json!({ "$minKey": 1 }),
        "MaxKey" => json!({ "$maxKey": 1 }),
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

    #[test]
    fn understands_mongosh_helpers_and_regex() {
        let cmd = to_command(
            r#"db.t.find({ts: Timestamp(1700000000, 1), bin: BinData(0, "AAECAw=="), uuid: UUID("c9a646d3-9c61-4cb3-b9e1-3f2e0b3e5a10"), lo: MinKey(), hi: MaxKey, nan: NaN, inf: -Infinity, email: /^a\/(b)[)]/i, n: {$in: [1, /x/]}})"#,
        )
        .unwrap()
        .unwrap();
        let filter = cmd.get_document("filter").unwrap();
        assert!(
            matches!(filter.get("ts"), Some(Bson::Timestamp(t)) if t.time == 1_700_000_000 && t.increment == 1)
        );
        assert!(matches!(filter.get("bin"), Some(Bson::Binary(b)) if b.bytes == [0, 1, 2, 3]));
        assert!(
            matches!(filter.get("uuid"), Some(Bson::Binary(b)) if b.subtype == mongodb::bson::spec::BinarySubtype::Uuid)
        );
        assert_eq!(filter.get("lo"), Some(&Bson::MinKey));
        assert_eq!(filter.get("hi"), Some(&Bson::MaxKey));
        assert!(filter.get_f64("nan").unwrap().is_nan());
        assert_eq!(filter.get_f64("inf").unwrap(), f64::NEG_INFINITY);
        match filter.get("email") {
            Some(Bson::RegularExpression(re)) => {
                assert_eq!(re.pattern, "^a\\/(b)[)]");
                assert_eq!(re.options, "i");
            }
            other => panic!("{other:?}"),
        }
        assert!(to_command("db.t.find({x: Timestamp(1)})").unwrap().is_err());
        assert!(to_command("db.t.find({x: foo})")
            .unwrap()
            .unwrap_err()
            .contains("Anführungszeichen"));
    }

    #[test]
    fn chain_errors_name_the_alternative() {
        let explain = to_command("db.users.find().explain()")
            .unwrap()
            .unwrap_err();
        assert!(
            explain.contains("Nicht unterstützt: .explain()"),
            "{explain}"
        );
        let count = to_command("db.users.find({a: 1}).count()")
            .unwrap()
            .unwrap();
        assert_eq!(count.get_str("aggregate").unwrap(), "users");
        assert_eq!(
            count.get_array("pipeline").unwrap()[0]
                .as_document()
                .unwrap()
                .get_document("$match")
                .unwrap(),
            &doc! { "a": 1 }
        );
        assert!(to_command("db.users.find().pretty()").unwrap().is_ok());
        assert_eq!(
            to_command("db.runCommand({ping: 1})").unwrap().unwrap(),
            doc! { "ping": 1 }
        );
        assert!(to_command("db.runCommand(1)").unwrap().is_err());
        assert!(to_command("db.stats()")
            .unwrap()
            .unwrap_err()
            .contains("runCommand"));
        let commented = to_command("// Kommentar\n/* c */ db.users.find() // Ende")
            .unwrap()
            .unwrap();
        assert_eq!(commented.get_str("find").unwrap(), "users");
        let json = to_command("// c\n{\"ping\": 1}").unwrap().unwrap();
        assert_eq!(json, doc! { "ping": 1 });
        assert!(to_command("{\"ping\": 1}").is_none());
    }

    #[test]
    fn count_documents_always_returns_one_row() {
        let cmd = to_command("db.big.countDocuments({status: \"nope\"})")
            .unwrap()
            .unwrap();
        let pipeline = cmd.get_array("pipeline").unwrap();
        assert!(pipeline[1].as_document().unwrap().contains_key("$facet"));
        assert!(pipeline[2].as_document().unwrap().contains_key("$project"));
    }

    #[test]
    fn splits_statements_at_semicolons_and_lines() {
        assert_eq!(
            split("db.a.drop(); db.a.insertOne({_id: 1})"),
            vec!["db.a.drop()", "db.a.insertOne({_id: 1})"]
        );
        assert_eq!(
            split(
                "// Kopf\ndb.a.find({\n  x: \";\" // c ;\n})\n  .sort({x: 1})\n\n{\"ping\": 1}\n"
            ),
            vec![
                "db.a.find({\n  x: \";\" // c ;\n})\n  .sort({x: 1})",
                "{\"ping\": 1}"
            ]
        );
        assert_eq!(
            split("db.a.find({re: /;\\n(/})"),
            vec!["db.a.find({re: /;\\n(/})"]
        );
        assert_eq!(split("{\"find\": \"x\"}"), vec!["{\"find\": \"x\"}"]);
        assert!(split("  \n// nur Kommentar\n").is_empty());
    }
}
