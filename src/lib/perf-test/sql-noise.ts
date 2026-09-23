const READ_ONLY_START = /^(select|with|table|values|show)\b/i;

const WRITING_KEYWORD =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|call|do|vacuum|refresh)\b/i;

const MONGO_READ_METHODS = new Set([
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "count",
  "distinct",
]);

const MONGO_READ_COMMANDS = new Set(["find", "aggregate", "count", "distinct"]);

const MONGO_WRITING_STAGE = /["']?\$(out|merge)["']?\s*:/;

const REDIS_READ = new Set([
  "GET",
  "MGET",
  "GETRANGE",
  "STRLEN",
  "EXISTS",
  "TYPE",
  "TTL",
  "PTTL",
  "SCAN",
  "DBSIZE",
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
  "PING",
  "ECHO",
  "TIME",
  "JSON.GET",
  "JSON.TYPE",
  "JSON.OBJKEYS",
  "JSON.ARRLEN",
  "FT.SEARCH",
  "GEOPOS",
  "GEODIST",
  "GEOSEARCH",
  "PFCOUNT",
  "BITCOUNT",
  "GETBIT",
  "LCS",
]);

export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;+$/, "")
    .trim();
}

export function isReadOnlyStatement(sql: string): boolean {
  const cleaned = stripSqlNoise(sql);
  if (cleaned.length === 0) return false;
  if (cleaned.includes(";")) return false;
  if (!READ_ONLY_START.test(cleaned)) return false;
  return !WRITING_KEYWORD.test(cleaned);
}

function isReadOnlyMongo(text: string): boolean {
  if (text.length === 0 || MONGO_WRITING_STAGE.test(text)) return false;
  if (text.startsWith("db.")) {
    if (text.includes(";")) return false;
    const call = /^db\.(?:getCollection\([^)]*\)|[\w.$-]+?)\.(\w+)\s*\(/.exec(text);
    return Boolean(call && MONGO_READ_METHODS.has(call[1]));
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const first = Object.keys(parsed)[0];
    return first !== undefined && MONGO_READ_COMMANDS.has(first);
  } catch {
    return false;
  }
}

function isReadOnlyRedis(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) return false;
  return lines.every((line) => REDIS_READ.has((line.split(/\s+/)[0] ?? "").toUpperCase()));
}

export function perfStatement(language: string, text: string): string {
  if (language === "redis") return text.trim();
  if (language === "json") return text.trim().replace(/;+$/, "").trim();
  return stripSqlNoise(text);
}

export function isReadOnlyFor(language: string, text: string): boolean {
  if (language === "json") return isReadOnlyMongo(perfStatement(language, text));
  if (language === "redis") return isReadOnlyRedis(text);
  return isReadOnlyStatement(text);
}

export function readOnlyRequirement(language: string): string {
  if (language === "json") {
    return "Nur lesende MongoDB-Befehle (find, findOne, aggregate ohne $out/$merge, countDocuments, distinct) können gemessen werden.";
  }
  if (language === "redis") {
    return "Nur lesende Redis-Befehle (z. B. GET, HGETALL, SCAN, LRANGE) können gemessen werden.";
  }
  return "Nur eine einzelne lesende Abfrage (SELECT/WITH) kann gemessen werden, damit der Test keine Daten verändert.";
}
