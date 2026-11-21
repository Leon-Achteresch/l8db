import { MONGO_WRITING_STAGE, REDIS_READ } from "@/lib/read-only-statement";
import { splitSqlStatements } from "@/lib/sql-statements";

interface Token {
  word: string;
  depth: number;
  start: number;
}

function isWordStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isWordPart(code: number): boolean {
  return isWordStart(code) || (code >= 48 && code <= 57) || code === 36;
}

export function sqlTokens(sql: string, dialect?: string, comments?: [number, number][]): Token[] {
  const result: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const tokenStart = i;
    const c = sql[i];
    const code = sql.charCodeAt(i);
    if ((c === "-" && sql[i + 1] === "-") || (dialect === "mysql" && c === "#")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
      comments?.push([tokenStart, i]);
    } else if (c === "/" && sql[i + 1] === "*") {
      let nesting = 1;
      i += 2;
      while (i < sql.length && nesting) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          nesting++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          nesting--;
          i += 2;
        } else i++;
      }
      comments?.push([tokenStart, i]);
    } else if ((c === "q" || c === "Q") && sql[i + 1] === "'" && dialect === "oracle") {
      const opening = sql[i + 2];
      const closing =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[opening] ?? opening;
      const end = sql.indexOf(`${closing}'`, i + 3);
      i = end < 0 ? sql.length : end + 2;
    } else if (c === "$" && /^\$(?:[A-Za-z_][\w]*)?\$/.test(sql.slice(i))) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)![0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const backslashEscapes =
        dialect === "mysql" ||
        (c === "'" && /[eE]/.test(sql[i - 1] ?? "") && !/[\w$]/.test(sql[i - 2] ?? ""));
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) i += 2;
          else {
            i++;
            break;
          }
        } else if (sql[i] === "\\" && backslashEscapes) i += 2;
        else i++;
      }
      result.push({ word: "identifier", depth, start: tokenStart });
    } else if (c === "(") {
      depth++;
      i++;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      result.push({ word: ")", depth, start: tokenStart });
      i++;
    } else if (isWordStart(code)) {
      const start = i++;
      while (i < sql.length && isWordPart(sql.charCodeAt(i))) i++;
      result.push({ word: sql.slice(start, i).toUpperCase(), depth, start });
    } else {
      if (c === ";") result.push({ word: ";", depth, start: tokenStart });
      i++;
    }
  }
  return result;
}

export interface DestructiveStatement {
  sql: string;
  reason: string;
}

function withoutWhere(words: Token[], index: number): boolean {
  const token = words[index];
  for (let j = index + 1; j < words.length; j++) {
    const next = words[j];
    if (
      next.depth < token.depth ||
      (next.depth === token.depth && [";", "RETURNING"].includes(next.word))
    )
      break;
    if (next.depth === token.depth && next.word === "WHERE") return false;
  }
  return true;
}

const CLAUSE_BEFORE_DML = new Set(["FOR", "KEY", "DO", "ON", "OR", "OF", "BEFORE", "AFTER"]);

function dmlCommand(words: Token[], index: number, routine: boolean): boolean {
  const first = words[0]?.word;
  if (routine || first === "MERGE" || (first === "ALTER" && words[1]?.word === "DEFAULT"))
    return false;
  return !CLAUSE_BEFORE_DML.has(words[index - 1]?.word) && words[index + 1]?.word !== "STATISTICS";
}

export interface SafetyOptions {
  strict?: boolean;
}

const DROP_REASONS: Record<string, string> = {
  TABLE: "Tabelle löschen",
  DATABASE: "Datenbank löschen",
  SCHEMA: "Schema löschen",
  KEYSPACE: "Keyspace löschen",
  VIEW: "View löschen",
  MATERIALIZED: "View löschen",
  INDEX: "Index löschen",
  COLUMN: "Spalte löschen",
};
const KEEPS_DATA_DROPS = new Set(["DEFAULT", "NOT", "IDENTITY", "EXPRESSION"]);
const MONGO_DESTRUCTIVE =
  /\.(deleteMany|remove|drop|dropDatabase)\s*\(|"(delete|drop|dropDatabase)"\s*:/;
const MONGO_REASONS: Record<string, string> = {
  deleteMany: "Dokumente löschen",
  remove: "Dokumente löschen",
  delete: "Dokumente löschen",
  drop: "Collection löschen",
  dropDatabase: "Datenbank löschen",
};

const REDIS_DESTRUCTIVE: Record<string, string> = {
  FLUSHALL: "Alle Schlüssel löschen",
  FLUSHDB: "Alle Schlüssel löschen",
  SHUTDOWN: "Server beenden",
  SWAPDB: "Datenbanken tauschen",
  RENAME: "Schlüssel umbenennen, Ziel wird überschrieben",
  MIGRATE: "Schlüssel auf anderen Server verschieben",
  DEBUG: "Debug-Befehl",
  REPLICAOF: "Replikation umstellen",
  SLAVEOF: "Replikation umstellen",
  "CONFIG SET": "Serverkonfiguration ändern",
  "CONFIG RESETSTAT": "Serverstatistik zurücksetzen",
  "CONFIG REWRITE": "Konfigurationsdatei überschreiben",
  "SCRIPT FLUSH": "Skripte löschen",
  "FUNCTION FLUSH": "Funktionen löschen",
  "FUNCTION DELETE": "Funktion löschen",
  "CLUSTER RESET": "Cluster zurücksetzen",
  "MODULE UNLOAD": "Modul entladen",
  "ACL DELUSER": "Benutzer löschen",
  "CLIENT KILL": "Verbindungen trennen",
};

const REDIS_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", a: "\x07" };

function redisWords(line: string): string[] | null {
  const words: string[] = [];
  let current = "";
  let quote: string | null = null;
  let token = false;
  let closed = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (closed && !/\s/.test(char)) return null;
    if (quote !== null && char === quote) {
      quote = null;
      closed = true;
    } else if (quote === '"' && char === "\\") {
      const next = line[++index];
      if (next === undefined) return null;
      if (next === "x") {
        const hex = line.slice(index + 1, index + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
        current += String.fromCharCode(Number.parseInt(hex, 16));
        index += 2;
      } else current += REDIS_ESCAPES[next] ?? next;
    } else if (quote === "'" && char === "\\" && line[index + 1] === "'") {
      current += "'";
      index += 1;
    } else if (quote === null && (char === '"' || char === "'")) {
      quote = char;
      token = true;
    } else if (quote === null && /\s/.test(char)) {
      if (token) words.push(current);
      current = "";
      token = false;
      closed = false;
    } else {
      current += char;
      token = true;
    }
  }
  if (quote !== null) return null;
  if (token) words.push(current);
  return words;
}

function redisDestructive(line: string, strict: boolean): string | null {
  const words = (redisWords(line) ?? line.trim().split(/\s+/)).map((word) => word.toUpperCase());
  const reason = REDIS_DESTRUCTIVE[`${words[0]} ${words[1]}`] ?? REDIS_DESTRUCTIVE[words[0]];
  if (reason) return reason;
  if (words[0] === "RESTORE" && words.includes("REPLACE")) return "Schlüssel überschreiben";
  if (strict && (words[0] === "DEL" || words[0] === "UNLINK")) return "Schlüssel löschen";
  return null;
}

const ES_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"]);
const ES_READ_ENDPOINTS = new Set([
  "_search",
  "_count",
  "_msearch",
  "_sql",
  "_mget",
  "_field_caps",
  "_validate",
  "_explain",
  "_termvectors",
  "_mtermvectors",
  "_pit",
  "_ppl",
]);
const ES_PLUGIN_PREFIXES = new Set(["_plugins", "_opendistro"]);

const ES_SQL_READS = new Set(["SELECT", "SHOW", "DESCRIBE", "DESC"]);
const ES_PPL_READS = new Set(["SOURCE", "SEARCH", "DESCRIBE", "SHOW"]);

interface EsRequest {
  method: string;
  path: string;
  body: string;
}

export function elasticRequests(sql: string): EsRequest[] | null {
  const requests: EsRequest[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const head = trimmed.split(/\s/, 1)[0] ?? "";
    const rest = trimmed.slice(head.length).trim();
    if (ES_METHODS.has(head.toUpperCase()) && rest && !rest.startsWith("{")) {
      const inline = /^(\S+)\s+([{[][\s\S]*)$/.exec(rest);
      requests.push({
        method: head.toUpperCase(),
        path: (inline?.[1] ?? rest).replace(/^\/+/, ""),
        body: inline ? `${inline[2]}\n` : "",
      });
    } else if (requests.length) requests[requests.length - 1].body += `${line}\n`;
    else if (trimmed) return null;
  }
  return requests.length ? requests : null;
}

function elasticSegments(path: string): string[] | null {
  const segments = path.split(/[?#]/)[0].split(/[/\\]/);
  try {
    const decoded = segments.map((segment) => decodeURIComponent(segment));
    return decoded.some((part) => part === "." || part === ".." || /[/\\]/.test(part))
      ? null
      : decoded;
  } catch {
    return null;
  }
}

function elasticSqlReads(endpoint: string, request: EsRequest): boolean {
  const params = new URLSearchParams(request.path.split("#")[0].split("?")[1] ?? "");
  if (params.has("sql") || params.has("query")) return false;
  let body: unknown;
  try {
    body = JSON.parse(request.body);
  } catch {
    return false;
  }
  const query =
    typeof body === "object" && body !== null ? (body as { query?: unknown }).query : undefined;
  if (typeof query !== "string") return false;
  const statement = query.trim().replace(/;+$/, "");
  if (statement.includes(";")) return false;
  const word = (statement.split(/[^\p{L}\p{N}_]/u)[0] ?? "").toUpperCase();
  return (endpoint === "_ppl" ? ES_PPL_READS : ES_SQL_READS).has(word);
}

function elasticReads(request: EsRequest): boolean {
  const segments = elasticSegments(request.path);
  if (!segments) return false;
  const endpoint = segments.find(
    (segment) => segment.startsWith("_") && !ES_PLUGIN_PREFIXES.has(segment),
  );
  if (endpoint === "_sql" || endpoint === "_ppl") return elasticSqlReads(endpoint, request);
  if (request.method === "GET" || request.method === "HEAD") return true;
  return request.method === "POST" && endpoint !== undefined && ES_READ_ENDPOINTS.has(endpoint);
}

function elasticDestructive(request: EsRequest, strict: boolean): string | null {
  const segments = elasticSegments(request.path) ?? [];
  if (segments.includes("_delete_by_query")) return "Dokumente per Query löschen";
  if (request.method !== "DELETE") return null;
  const target = segments.filter(Boolean);
  if (target.length === 1 && !target[0].startsWith("_")) return "Index löschen";
  if (target[0] === "_data_stream") return "Data Stream löschen";
  if (target.length === 1 || target[0].startsWith("_")) return "Objekt löschen";
  return strict ? "Dokument löschen" : null;
}

const FLUX_READ_PACKAGES = new Set([
  "array",
  "csv",
  "date",
  "date/boundaries",
  "dict",
  "experimental",
  "experimental/aggregate",
  "experimental/array",
  "experimental/date/boundaries",
  "experimental/geo",
  "experimental/json",
  "experimental/table",
  "generate",
  "influxdata/influxdb",
  "influxdata/influxdb/sample",
  "influxdata/influxdb/schema",
  "influxdata/influxdb/v1",
  "interpolate",
  "join",
  "json",
  "math",
  "regexp",
  "runtime",
  "sampledata",
  "strings",
  "system",
  "timezone",
  "types",
  "universe",
]);
const FLUX_REGEX_WORDS = new Set(["return", "then", "else", "and", "or", "not"]);

function fluxRegexPosition(code: string): boolean {
  const trimmed = code.trimEnd();
  const last = trimmed.at(-1);
  if (last === undefined || "~(,:[{=".includes(last)) return true;
  const word = /[\p{L}\p{N}_]+$/u.exec(trimmed)?.[0];
  return word !== undefined && FLUX_REGEX_WORDS.has(word);
}

interface FluxScan {
  code: string;
  strings: string[];
}

function fluxScan(text: string, start: number, scan: FluxScan, level: number): number | null {
  if (level > 32) return null;
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      let value = "";
      index += 1;
      while (text[index] !== '"') {
        if (index >= text.length) return null;
        if (text[index] === "\\") {
          if (index + 1 >= text.length) return null;
          value += text.slice(index, index + 2);
          index += 2;
        } else if (text[index] === "$" && text[index + 1] === "{") {
          value += "${";
          scan.code += " ";
          const end = fluxScan(text, index + 2, scan, level + 1);
          if (end === null) return null;
          scan.code += " ";
          index = end;
        } else value += text[index++];
      }
      scan.code += `"${scan.strings.length}"`;
      scan.strings.push(value);
    } else if (char === "/" && text[index + 1] === "/") {
      while (index + 1 < text.length && text[index + 1] !== "\n") index += 1;
    } else if (char === "/" && fluxRegexPosition(scan.code)) {
      index += 1;
      while (text[index] !== "/") {
        if (index >= text.length || text[index] === "\n") return null;
        index += text[index] === "\\" ? 2 : 1;
      }
      scan.code += '""';
    } else if (char === "}" && level > 0 && depth === 0) return index + 1;
    else {
      if (char === "{") depth += 1;
      else if (char === "}") depth = Math.max(0, depth - 1);
      scan.code += char;
    }
  }
  return level > 0 ? null : text.length;
}

function fluxWrites(text: string): boolean {
  const scan: FluxScan = { code: "", strings: [] };
  if (fluxScan(text, 0, scan, 0) === null) return true;
  const { code, strings } = scan;
  for (const match of code.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const end = match.index + match[0].length;
    if (match[0] === "import") {
      const path = /^\s*(?:[\p{L}\p{N}_]+\s*)?"(\d+)"/u.exec(code.slice(end))?.[1];
      const name = path === undefined ? undefined : strings[Number(path)];
      if (name === undefined || !FLUX_READ_PACKAGES.has(name)) return true;
    }
    if (match[0] !== "to" && match[0] !== "wideTo") continue;
    const before = code.slice(0, match.index).trimEnd().at(-1);
    const after = code.slice(end).trimStart()[0];
    if (after !== ":" && (before !== "." || after === "(")) return true;
  }
  return false;
}

const INFLUX_SQL_WORDS = new Set([
  "SELECT",
  "SHOW",
  "WITH",
  "EXPLAIN",
  "DROP",
  "CREATE",
  "DELETE",
  "INSERT",
  "UPDATE",
  "ALTER",
  "IMPORT",
  "FROM",
  "OPTION",
  "GRANT",
]);
const LINE_PROTOCOL = /^[^\s,#"(=]+(,\S+)?\s+[^\s=]+=\S.*$/;

function influxFirstWord(text: string): string {
  return (text.trimStart().split(/[\s,(]/)[0] ?? "").toUpperCase();
}

function influxWrites(text: string): boolean | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (
    lines.length &&
    lines.every(
      (line) =>
        LINE_PROTOCOL.test(line) &&
        !INFLUX_SQL_WORDS.has(influxFirstWord(line)) &&
        !line.includes("|>"),
    )
  )
    return true;
  const start = text.trimStart();
  const flux = text.includes("|>") || /^(?:from\(|import |buckets\(|option )/.test(start);
  if (flux || !INFLUX_SQL_WORDS.has(influxFirstWord(text))) {
    const writes = fluxWrites(text);
    if (flux || writes) return writes;
  }
  return null;
}

export function destructiveStatements(
  sql: string,
  dialect?: string,
  options: SafetyOptions = {},
): DestructiveStatement[] {
  if (dialect === "redis")
    return sql.split(/\r?\n/).flatMap((line) => {
      const reason = redisDestructive(line, options.strict === true);
      return reason ? [{ sql: line.trim(), reason }] : [];
    });
  if (dialect === "mongodb") {
    const match = MONGO_DESTRUCTIVE.exec(sql);
    return match ? [{ sql: sql.trim(), reason: MONGO_REASONS[match[1] ?? match[2]] }] : [];
  }
  if (dialect === "elasticsearch") {
    const requests = elasticRequests(sql);
    if (requests)
      return requests.flatMap((request) => {
        const reason = elasticDestructive(request, options.strict === true);
        return reason ? [{ sql: `${request.method} ${request.path}`, reason }] : [];
      });
  }
  return splitSqlStatements(sql, dialect).statements.flatMap((statement) => {
    const words = sqlTokens(statement.text, dialect);
    let reason: string | null = null;
    if (["GRANT", "REVOKE"].includes(words[0]?.word)) return [];
    const routine = definesRoutine(words);
    for (let i = 0; i < words.length; i++) {
      const token = words[i];
      const dropped = token.word === "DROP" ? DROP_REASONS[words[i + 1]?.word] : undefined;
      if (dropped) reason = dropped;
      else if (
        token.word === "DROP" &&
        words[0]?.word === "ALTER" &&
        !KEEPS_DATA_DROPS.has(words[i + 1]?.word)
      )
        reason = "Spalte oder Bestandteil löschen";
      else if (options.strict && token.word === "DROP" && i === 0) reason = "Objekt löschen";
      if (token.word === "TRUNCATE") reason = "Tabelle leeren";
      if (
        (token.word === "DELETE" || token.word === "UPDATE") &&
        dmlCommand(words, i, routine) &&
        withoutWhere(words, i)
      )
        reason = `${token.word} ohne WHERE`;
      if (options.strict && token.word === "ALTER" && i === 0) reason = "Struktur ändern";
      if (dialect === "clickhouse" && words[0]?.word === "ALTER" && token.depth === 0) {
        if (token.word === "DELETE") reason = "Mutation: Zeilen löschen";
        else if (options.strict && token.word === "UPDATE") reason = "Mutation: Zeilen ändern";
      }
    }
    return reason ? [{ sql: statement.text, reason }] : [];
  });
}

const READ_WORDS = new Set([
  "SELECT",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "DESC",
  "VALUES",
  "TABLE",
  "USE",
  "PRAGMA",
]);
const MODIFYING_WORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "INTO"]);
const MONGO_READ_COMMANDS = new Set([
  "find",
  "aggregate",
  "count",
  "distinct",
  "listCollections",
  "listIndexes",
]);
const MONGO_READ_METHODS = new Set([
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "count",
  "distinct",
]);
const MONGO_FIND_CHAIN = new Set([
  "pretty",
  "toArray",
  "count",
  "sort",
  "limit",
  "skip",
  "projection",
  "hint",
]);
const MONGO_CHAIN = new Set(["pretty", "toArray"]);
const MONGO_FIRST_KEY = /^\{\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*))\s*:/;

function mongoCommentEnd(text: string, start: number): number {
  if (text[start + 1] === "/") {
    const end = text.indexOf("\n", start + 2);
    return end < 0 ? text.length : end;
  }
  const end = text.indexOf("*/", start + 2);
  return end < 0 ? text.length : end + 2;
}

function mongoComment(text: string, index: number): boolean {
  return text[index] === "/" && (text[index + 1] === "/" || text[index + 1] === "*");
}

function mongoStringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== text[start]) index += text[index] === "\\" ? 2 : 1;
  return index;
}

function mongoRegexEnd(text: string, start: number): number {
  let inClass = false;
  for (let index = start + 1; index < text.length && text[index] !== "\n"; index++) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      while (/[A-Za-z]/.test(text[index + 1] ?? "")) index += 1;
      return index;
    }
  }
  return start;
}

function mongoClosing(text: string, open: number): number {
  let depth = 0;
  let previous = "";
  for (let index = open; index < text.length; index++) {
    if (mongoComment(text, index)) {
      index = mongoCommentEnd(text, index) - 1;
      continue;
    }
    const char = text[index];
    if (char === '"' || char === "'") index = mongoStringEnd(text, index);
    else if (char === "/" && previous && ":,([{".includes(previous))
      index = mongoRegexEnd(text, index);
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      depth -= 1;
      if (depth === 0) return index;
    }
    if (!/\s/.test(char)) previous = char;
  }
  return -1;
}

function mongoFirstKey(text: string): string | undefined {
  const match = MONGO_FIRST_KEY.exec(text);
  if (!match) return undefined;
  if (match[3] !== undefined) return match[3];
  try {
    return JSON.parse(`"${match[1] ?? match[2]}"`);
  } catch {
    return undefined;
  }
}

function mongoShellReads(rest: string): boolean {
  if (rest.startsWith("runCommand")) {
    const call = rest.slice("runCommand".length).trimStart();
    const close = call.startsWith("(") ? mongoClosing(call, 0) : -1;
    if (close < 0 || call.slice(close + 1).trim()) return false;
    const command = mongoFirstKey(call.slice(1, close).trim());
    return command !== undefined && MONGO_READ_COMMANDS.has(command);
  }
  let index: number;
  if (rest.startsWith("getCollection(")) {
    index = mongoClosing(rest, "getCollection".length) + 1;
    if (index === 0) return false;
  } else {
    const paren = rest.indexOf("(");
    index = (paren < 0 ? rest : rest.slice(0, paren)).lastIndexOf(".");
    if (index <= 0) return false;
  }
  const methods: string[] = [];
  while (index < rest.length) {
    if (/\s/.test(rest[index])) index += 1;
    else if (mongoComment(rest, index)) index = mongoCommentEnd(rest, index);
    else if (rest[index] !== ".") return false;
    else {
      const name = /^[\p{L}\p{N}_]*/u.exec(rest.slice(index + 1))?.[0] ?? "";
      index += 1 + name.length;
      while (/\s/.test(rest[index] ?? "")) index += 1;
      const close = rest[index] === "(" ? mongoClosing(rest, index) : -1;
      if (close < 0) return false;
      methods.push(name);
      index = close + 1;
    }
  }
  const [first, ...chain] = methods;
  if (first === undefined || !MONGO_READ_METHODS.has(first)) return false;
  const allowed = first === "find" || first === "findOne" ? MONGO_FIND_CHAIN : MONGO_CHAIN;
  return chain.every((name) => allowed.has(name));
}

function mongoWrites(sql: string): boolean {
  let text = sql.trimStart();
  while (mongoComment(text, 0)) text = text.slice(mongoCommentEnd(text, 0)).trimStart();
  text = text.trimEnd().replace(/;+$/, "").trimEnd();
  if (MONGO_WRITING_STAGE.test(text)) return true;
  if (text.startsWith("db.")) return !mongoShellReads(text.slice(3));
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return true;
  } catch {
    return true;
  }
  const command = mongoFirstKey(text);
  return command === undefined || !MONGO_READ_COMMANDS.has(command);
}

export function writesData(sql: string, dialect?: string): boolean {
  const text = sql.trim();
  if (!text) return false;
  if (dialect === "mongodb") return mongoWrites(text);
  if (dialect === "elasticsearch") {
    const requests = elasticRequests(text);
    if (requests) return !requests.every(elasticReads);
  }
  if (dialect === "influxdb") {
    const writes = influxWrites(text);
    if (writes !== null) return writes;
  }
  if (dialect === "redis")
    return text
      .split(/\r?\n/)
      .map((line) => (redisWords(line)?.[0] ?? line.trim().split(/\s+/)[0] ?? "").toUpperCase())
      .some((word) => word && !REDIS_READ.has(word));
  return splitSqlStatements(text, dialect).statements.some((statement) => {
    const words = sqlTokens(statement.text, dialect);
    const explained = explainedStatement(statement.text, dialect, words);
    if (explained !== null) return !explained || writesData(explained, dialect);
    const first = words[0]?.word;
    if (!first) return false;
    if (first === "WITH" || first === "SELECT")
      return words.some((token) => MODIFYING_WORDS.has(token.word));
    return !READ_WORDS.has(first);
  });
}

const EXPLAINABLE_WORDS = new Set([
  "SELECT",
  "WITH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "REPLACE",
  "CREATE",
  "TABLE",
  "VALUES",
  "EXECUTE",
  "DECLARE",
  "CALL",
]);

function explainedStatement(
  text: string,
  dialect?: string,
  words = sqlTokens(text, dialect),
): string | null {
  if (words[0]?.word !== "EXPLAIN") return null;
  const index = words.findIndex(
    (token, position) => position > 0 && token.depth === 0 && EXPLAINABLE_WORDS.has(token.word),
  );
  const options = words.slice(1, index < 0 ? undefined : index);
  if (!options.some((token) => token.word === "ANALYZE" || token.word === "ANALYSE")) return null;
  return index < 0 ? "" : text.slice(words[index].start);
}

export function analyzedSql(sql: string, dialect?: string): string {
  if (dialect === "redis" || dialect === "mongodb") return sql;
  const { statements } = splitSqlStatements(sql, dialect);
  if (!statements.some((statement) => explainedStatement(statement.text, dialect))) return sql;
  return statements
    .map((statement) => explainedStatement(statement.text, dialect) || statement.text)
    .map((text) => text.trim().replace(/;\s*$/, ""))
    .join(";\n");
}

const TRANSACTION_CONTROL_MESSAGE =
  "Transaktionsbefehle im Skript bitte entfernen und die Transaktionswahl des Dialogs verwenden.";
const IMPLICIT_COMMIT_MESSAGE =
  "Dieses Skript enthält DDL mit implizitem Commit. Bitte vorhandene Transaktionen abschließen und Autocommit wählen.";
const QUERY_TRANSACTION_CONTROL_MESSAGE =
  "Transaktionsbefehle bitte nicht im Editor ausführen, solange Transaktionen verwaltet werden. Commit und Rollback über das Transaktionspanel auslösen.";
const QUERY_IMPLICIT_COMMIT_MESSAGE =
  "Diese Anweisung löst einen impliziten Commit aus und kann nicht in einer verwalteten Transaktion laufen. Offene Transaktion über das Transaktionspanel abschließen oder DDL getrennt ausführen.";

const IMPLICIT_COMMIT_WORDS: Record<string, Set<string>> = {
  mysql: new Set([
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "RENAME",
    "LOCK",
    "UNLOCK",
    "ANALYZE",
    "OPTIMIZE",
    "REPAIR",
    "FLUSH",
    "INSTALL",
    "UNINSTALL",
  ]),
  oracle: new Set([
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "RENAME",
    "COMMENT",
    "ANALYZE",
    "AUDIT",
    "NOAUDIT",
    "PURGE",
    "FLASHBACK",
  ]),
  clickhouse: new Set(["CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE"]),
  cassandra: new Set(["CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE"]),
};

const ROUTINE_WORDS = new Set(["PROC", "PROCEDURE", "TRIGGER", "FUNCTION"]);
const GO_LINE = /^[ \t]*GO(?:[ \t]+\d+)?[ \t]*$/im;
const END_COMMITS = new Set(["postgres", "sqlite", "sqlite_http"]);

function definesRoutine(words: Token[]): boolean {
  const first = words[0]?.word;
  if (first !== "CREATE" && first !== "ALTER") return false;
  const object = first === "CREATE" && words[1]?.word === "OR" ? words[3] : words[1];
  return object !== undefined && ROUTINE_WORDS.has(object.word);
}

function controlsTransaction(words: Token[], dialect: string, managed: boolean): boolean {
  const first = words[0]?.word;
  const second = words[1]?.word;
  if (
    ["COMMIT", "ROLLBACK", "ABORT"].includes(first) ||
    (first === "START" && second === "TRANSACTION") ||
    (first === "PREPARE" && second === "TRANSACTION") ||
    (first === "BEGIN" && !["oracle", "mssql"].includes(dialect)) ||
    (first === "BEGIN" &&
      dialect === "mssql" &&
      ["TRAN", "TRANSACTION", "DISTRIBUTED"].includes(second)) ||
    (first === "END" && END_COMMITS.has(dialect))
  )
    return true;
  if (!managed) return false;
  if (dialect === "mssql")
    return words.some(
      (token, index) =>
        ["COMMIT", "ROLLBACK"].includes(token.word) ||
        (token.word === "BEGIN" &&
          ["TRAN", "TRANSACTION", "DISTRIBUTED"].includes(words[index + 1]?.word)),
    );
  if (dialect === "oracle" && ["BEGIN", "DECLARE"].includes(first))
    return words.some((token) => ["COMMIT", "ROLLBACK"].includes(token.word));
  return false;
}

function commitsImplicitly(words: Token[], dialect: string): boolean {
  const first = words[0]?.word;
  if (dialect === "mysql") {
    if (["CREATE", "DROP"].includes(first) && words[1]?.word === "TEMPORARY") return false;
    if (first === "SET" && words.some((token) => token.word === "AUTOCOMMIT")) return true;
  }
  return IMPLICIT_COMMIT_WORDS[dialect]?.has(first) ?? false;
}

function transactionIssue(
  sql: string,
  dialect: string,
  managed: boolean,
): "control" | "implicit" | null {
  if (dialect === "redis" || dialect === "mongodb") return null;
  for (const statement of splitSqlStatements(sql, dialect).statements) {
    if (dialect === "mssql") {
      let routine = false;
      for (const [index, batch] of statement.text.split(GO_LINE).entries()) {
        if (index > 0) routine = false;
        const words = sqlTokens(batch, dialect);
        routine ||= definesRoutine(words);
        if (!routine && controlsTransaction(words, dialect, managed)) return "control";
      }
      continue;
    }
    const words = sqlTokens(statement.text, dialect);
    if (controlsTransaction(words, dialect, managed)) return "control";
    if (managed && commitsImplicitly(words, dialect)) return "implicit";
  }
  return null;
}

export function scriptPolicyIssue(sql: string, dialect: string, managed: boolean): string | null {
  if (dialect === "oracle") return null;
  const issue = transactionIssue(sql, dialect, managed);
  if (issue === "control") return TRANSACTION_CONTROL_MESSAGE;
  if (issue === "implicit") return IMPLICIT_COMMIT_MESSAGE;
  return null;
}

export function managedQueryIssue(sql: string, dialect: string): string | null {
  const issue = transactionIssue(sql, dialect, true);
  if (issue === "control") return QUERY_TRANSACTION_CONTROL_MESSAGE;
  if (issue === "implicit") return QUERY_IMPLICIT_COMMIT_MESSAGE;
  return null;
}
