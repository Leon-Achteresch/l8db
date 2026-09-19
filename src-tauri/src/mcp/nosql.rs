use mongodb::bson::{Bson, Document};

use super::redact::{Redactor, SchemaIndex};
use crate::db::{mongo_shell, mongodb::parse_document, redis::split_command};

const MONGO_READ: &[&str] = &[
    "find",
    "aggregate",
    "count",
    "distinct",
    "listCollections",
    "listIndexes",
];
const MONGO_WRITE: &[&str] = &["insert", "update", "delete", "findAndModify"];
const MONGO_DDL: &[&str] = &[
    "create",
    "drop",
    "createIndexes",
    "dropIndexes",
    "renameCollection",
    "collMod",
];
const MONGO_DANGEROUS: &[&str] = &[
    "$where",
    "$function",
    "$accumulator",
    "$out",
    "$merge",
    "$objectToArray",
];
const MONGO_FIELD_OPERATORS: &[&str] = &["$getField", "$setField", "$unsetField"];

const REDIS_READ: &[&str] = &[
    "GET",
    "MGET",
    "GETRANGE",
    "STRLEN",
    "EXISTS",
    "TYPE",
    "TTL",
    "PTTL",
    "KEYS",
    "SCAN",
    "DBSIZE",
    "RANDOMKEY",
    "HGET",
    "HMGET",
    "HGETALL",
    "HKEYS",
    "HVALS",
    "HLEN",
    "HEXISTS",
    "HSCAN",
    "LRANGE",
    "LLEN",
    "LINDEX",
    "LPOS",
    "SMEMBERS",
    "SCARD",
    "SISMEMBER",
    "SMISMEMBER",
    "SSCAN",
    "ZRANGE",
    "ZREVRANGE",
    "ZRANGEBYSCORE",
    "ZREVRANGEBYSCORE",
    "ZCARD",
    "ZSCORE",
    "ZRANK",
    "ZREVRANK",
    "ZCOUNT",
    "ZSCAN",
    "XRANGE",
    "XREVRANGE",
    "XLEN",
    "XINFO",
    "PING",
    "ECHO",
    "INFO",
    "TIME",
    "OBJECT",
    "MEMORY",
    "JSON.GET",
    "JSON.TYPE",
    "JSON.OBJKEYS",
    "JSON.ARRLEN",
    "FT.SEARCH",
    "FT.INFO",
    "GEOPOS",
    "GEODIST",
    "GEOSEARCH",
    "PFCOUNT",
    "BITCOUNT",
    "GETBIT",
    "LCS",
];
const REDIS_DANGEROUS: &[&str] = &[
    "FLUSHALL",
    "FLUSHDB",
    "CONFIG",
    "DEBUG",
    "SHUTDOWN",
    "SLAVEOF",
    "REPLICAOF",
    "EVAL",
    "EVALSHA",
    "EVAL_RO",
    "EVALSHA_RO",
    "FCALL",
    "FCALL_RO",
    "SCRIPT",
    "FUNCTION",
    "MODULE",
    "CLIENT",
    "ACL",
    "MIGRATE",
    "SAVE",
    "BGSAVE",
    "BGREWRITEAOF",
    "CLUSTER",
    "MONITOR",
    "SYNC",
    "PSYNC",
    "SUBSCRIBE",
    "PSUBSCRIBE",
    "SSUBSCRIBE",
    "SWAPDB",
    "AUTH",
    "HELLO",
    "SELECT",
    "RESET",
    "QUIT",
    "FAILOVER",
    "LATENCY",
    "SLOWLOG",
];

pub fn mongo_command(input: &str) -> Result<Document, String> {
    let command = match mongo_shell::to_command(input) {
        Some(command) => command?,
        None => parse_document(input, "Der Befehl")?,
    };
    if command.is_empty() {
        return Err(
            "Gib einen MongoDB-Befehl ein, z. B. db.users.find({}) oder {\"find\": \"users\"}."
                .into(),
        );
    }
    Ok(command)
}

pub fn mongo_check(
    command: &Document,
    write: bool,
    allow_ddl: bool,
    redactor: &Redactor,
    index: &SchemaIndex,
) -> Result<(), String> {
    let (name, target) = command.iter().next().ok_or("Leerer Befehl")?;
    let allowed = if write {
        MONGO_READ.contains(&name.as_str())
            || MONGO_WRITE.contains(&name.as_str())
            || (allow_ddl && MONGO_DDL.contains(&name.as_str()))
    } else {
        MONGO_READ.contains(&name.as_str())
    };
    if !allowed {
        let hint = if !write && MONGO_WRITE.contains(&name.as_str()) {
            " Für Schreibzugriffe execute nutzen."
        } else if write && MONGO_DDL.contains(&name.as_str()) {
            " DDL ist für diese Verbindung nicht freigegeben."
        } else {
            ""
        };
        return Err(format!(
            "MongoDB-Befehl '{name}' ist über den MCP nicht erlaubt.{hint}"
        ));
    }
    if let Some(collection) = target.as_str() {
        if index.table_hidden(&collection.to_lowercase()) {
            return Err(format!(
                "Collection '{collection}' liegt in einem nicht freigegebenen Schema."
            ));
        }
    }
    walk(&Bson::Document(command.clone()), redactor, index)
}

fn walk(value: &Bson, redactor: &Redactor, index: &SchemaIndex) -> Result<(), String> {
    match value {
        Bson::Document(document) => {
            for (key, inner) in document {
                if MONGO_DANGEROUS.contains(&key.as_str()) {
                    return Err(format!("Operator '{key}' ist über den MCP gesperrt."));
                }
                let collection = match (key.as_str(), inner) {
                    ("$lookup" | "$graphLookup", Bson::Document(stage)) => stage.get("from"),
                    ("$unionWith", Bson::Document(stage)) => stage.get("coll"),
                    ("$unionWith", other) => Some(other),
                    _ => None,
                };
                if let Some(collection) = collection {
                    match collection.as_str() {
                        Some(name) if !index.table_hidden(&name.to_lowercase()) => {}
                        _ => {
                            return Err(format!(
                                "'{key}' verweist auf eine nicht freigegebene Collection."
                            ))
                        }
                    }
                }
                if MONGO_FIELD_OPERATORS.contains(&key.as_str()) {
                    let field = match inner {
                        Bson::String(field) => Some(field.as_str()),
                        Bson::Document(args) => args.get_str("field").ok(),
                        _ => None,
                    };
                    if field.is_none_or(|field| redactor.column_is_sensitive(field)) {
                        return Err(format!(
                            "'{key}' braucht einen freigegebenen, festen Feldnamen."
                        ));
                    }
                }
                if key
                    .split('.')
                    .any(|part| redactor.column_is_sensitive(part))
                {
                    return Err(format!(
                        "Feld '{key}' ist redigiert und darf im Befehl nicht referenziert werden."
                    ));
                }
                walk(inner, redactor, index)?;
            }
            Ok(())
        }
        Bson::Array(items) => items
            .iter()
            .try_for_each(|item| walk(item, redactor, index)),
        Bson::String(text) => match text.strip_prefix('$') {
            Some(path)
                if path
                    .split('.')
                    .any(|part| redactor.column_is_sensitive(part)) =>
            {
                Err(format!(
                    "Feld '{path}' ist redigiert und darf im Befehl nicht referenziert werden."
                ))
            }
            _ => Ok(()),
        },
        _ => Ok(()),
    }
}

pub fn redis_check(input: &str, write: bool) -> Result<(), String> {
    let lines: Vec<&str> = input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    if lines.is_empty() {
        return Err("Redis-Befehl fehlt".into());
    }
    if !write && lines.len() > 1 {
        return Err("Nur ein Befehl pro Aufruf.".into());
    }
    for line in lines {
        let args = split_command(line)?;
        let name = args
            .first()
            .and_then(|name| std::str::from_utf8(name).ok())
            .unwrap_or("")
            .to_ascii_uppercase();
        if REDIS_DANGEROUS.contains(&name.as_str()) {
            return Err(format!("Redis-Befehl '{name}' ist über den MCP gesperrt."));
        }
        if !write && !REDIS_READ.contains(&name.as_str()) {
            return Err(format!(
                "query ist read-only, '{name}' ist nicht erlaubt. Für Schreibzugriffe execute nutzen."
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::config::McpConfig;

    fn redactor() -> Redactor {
        Redactor::new(&McpConfig::default().redaction, &["password".into()])
    }

    fn index(redactor: &Redactor, schemas: &[String]) -> SchemaIndex {
        let columns = vec![
            crate::db::ColumnInfo {
                schema: "app".into(),
                table: "users".into(),
                name: "password".into(),
                data_type: "string".into(),
            },
            crate::db::ColumnInfo {
                schema: "other".into(),
                table: "secrets".into(),
                name: "x".into(),
                data_type: "string".into(),
            },
        ];
        SchemaIndex::new(&columns, redactor, schemas)
    }

    #[test]
    fn mongo_rules() {
        let redactor = redactor();
        let allowed = index(&redactor, &["app".into()]);
        let check = |input: &str, write: bool, ddl: bool| {
            mongo_check(
                &mongo_command(input).unwrap(),
                write,
                ddl,
                &redactor,
                &allowed,
            )
        };
        assert!(check("db.users.find({ name: 'a' })", false, false).is_ok());
        assert!(check("{\"count\": \"users\"}", false, false).is_ok());
        assert!(check("db.users.insertOne({ a: 1 })", false, false)
            .unwrap_err()
            .contains("execute"));
        assert!(check("db.users.insertOne({ a: 1 })", true, false).is_ok());
        assert!(check("db.users.drop()", true, false).is_err());
        assert!(check("db.users.drop()", true, true).is_ok());
        assert!(check("{\"eval\": \"1\"}", true, true).is_err());
        assert!(check("db.users.find({ password: 'x' })", false, false).is_err());
        assert!(check("db.users.find({ 'auth.password': 'x' })", false, false).is_err());
        assert!(check(
            "db.users.find({ $expr: { $eq: ['$password', 'x'] } })",
            false,
            false
        )
        .is_err());
        assert!(check("db.users.find({ $where: 'true' })", false, false).is_err());
        assert!(check("db.users.aggregate([{ $out: 'y' }])", true, true).is_err());
        assert!(check("db.secrets.find({})", false, false).is_err());
        assert!(check(
            "db.users.aggregate([{ $lookup: { from: 'secrets', localField: 'a', foreignField: 'b', as: 'c' } }])",
            false,
            false
        )
        .is_err());
        assert!(check(
            "db.users.aggregate([{ $unionWith: 'secrets' }])",
            false,
            false
        )
        .is_err());
        assert!(check(
            "db.users.aggregate([{ $unionWith: { coll: 'secrets', pipeline: [] } }])",
            false,
            false
        )
        .is_err());
        assert!(check(
            "db.users.aggregate([{ $graphLookup: { from: 'secrets', startWith: '$a', connectFromField: 'a', connectToField: 'b', as: 'c' } }])",
            false,
            false
        )
        .is_err());
        assert!(check(
            "db.users.aggregate([{ $unionWith: 'users' }])",
            false,
            false
        )
        .is_ok());
        assert!(check(
            "db.users.aggregate([{ $project: { leak: { $getField: 'password' } } }])",
            false,
            false
        )
        .is_err());
        assert!(check(
            "db.users.aggregate([{ $project: { leak: { $getField: { field: { $concat: ['pass', 'word'] }, input: '$$ROOT' } } } }])",
            false,
            false
        )
        .is_err());
        assert!(check(
            "db.users.aggregate([{ $project: { n: { $getField: 'name' } } }])",
            false,
            false
        )
        .is_ok());
        assert!(check(
            "db.users.aggregate([{ $project: { kv: { $objectToArray: '$$ROOT' } } }])",
            false,
            false
        )
        .is_err());
    }

    #[test]
    fn redis_rules() {
        assert!(redis_check("GET a", false).is_ok());
        assert!(redis_check("hgetall user:1", false).is_ok());
        assert!(redis_check("SET a 1", false)
            .unwrap_err()
            .contains("execute"));
        assert!(redis_check("SET a 1", true).is_ok());
        assert!(redis_check("GET a\nGET b", false).is_err());
        assert!(redis_check("MULTI\nSET a 1\nEXEC", true).is_ok());
        assert!(redis_check("FLUSHALL", true).is_err());
        assert!(redis_check("eval \"return 1\" 0", true).is_err());
        assert!(redis_check("", false).is_err());
    }
}
