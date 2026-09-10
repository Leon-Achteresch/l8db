export const REDIS_ACTIONS = {
  get: "Lesen",
  string: "String setzen",
  hash: "Hash-Feld setzen",
  list: "An Liste anhängen",
  set: "Set-Mitglied hinzufügen",
  zset: "Sorted-Set-Mitglied setzen",
  stream: "Stream-Eintrag hinzufügen",
  rename: "Umbenennen",
  expire: "Ablaufzeit setzen",
  persist: "Ablaufzeit entfernen",
  delete: "Key löschen",
} as const;

export type RedisAction = keyof typeof REDIS_ACTIONS;

export function quoteRedisArgument(value: string): string {
  return `"${Array.from(value, (character) => {
    if (character === '"' || character === "\\") return `\\${character}`;
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? `\\x${code.toString(16).padStart(2, "0")}` : character;
  }).join("")}"`;
}

export function redisActionCommand(
  action: RedisAction,
  key: string,
  value: string,
  field: string,
): string {
  const k = quoteRedisArgument(key);
  const v = quoteRedisArgument(value);
  const f = quoteRedisArgument(field);
  switch (action) {
    case "get":
      return `TYPE ${k}\nTTL ${k}`;
    case "string":
      return `SET ${k} ${v} KEEPTTL`;
    case "hash":
      return `HSET ${k} ${f} ${v}`;
    case "list":
      return `RPUSH ${k} ${v}`;
    case "set":
      return `SADD ${k} ${v}`;
    case "zset":
      if (!field.trim() || !Number.isFinite(Number(field)))
        throw Error("Score muss eine Zahl sein.");
      return `ZADD ${k} ${f} ${v}`;
    case "stream":
      return `XADD ${k} * ${f} ${v}`;
    case "rename":
      return `RENAMENX ${k} ${v}`;
    case "expire":
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
        throw Error("TTL muss eine positive ganze Zahl in Sekunden sein.");
      return `EXPIRE ${k} ${value}`;
    case "persist":
      return `PERSIST ${k}`;
    case "delete":
      return `UNLINK ${k}`;
  }
}

export function redisReadCommand(key: string, type: string): string | null {
  const k = quoteRedisArgument(key);
  switch (type) {
    case "string":
      return `GET ${k}`;
    case "hash":
      return `HGETALL ${k}`;
    case "list":
      return `LRANGE ${k} 0 -1`;
    case "set":
      return `SMEMBERS ${k}`;
    case "zset":
      return `ZRANGE ${k} 0 -1 WITHSCORES`;
    case "stream":
      return `XRANGE ${k} - +`;
    default:
      return null;
  }
}

export const REDIS_KEY_FILTER_OPERATORS = [
  { key: "eq", label: "ist gleich" },
  { key: "contains", label: "enthält" },
  { key: "startsWith", label: "beginnt mit" },
  { key: "endsWith", label: "endet mit" },
];

export function redisKeyFilter(column: string, operator: string, value: string): string | null {
  if (column !== "key" || !value) return null;
  const literal = value
    .replace(/[\\*?[\]]/g, "\\$&")
    .replace(/[ \t\r\n]/g, (character) => `[${character}]`);
  switch (operator) {
    case "eq":
      return literal;
    case "contains":
      return `*${literal}*`;
    case "startsWith":
      return `${literal}*`;
    case "endsWith":
      return `*${literal}`;
    default:
      return null;
  }
}

export function canEditRedisCell(row: Record<string, unknown>, column: string): boolean {
  if (typeof row.key !== "string" || row.key.startsWith("\\x")) return false;
  return (
    column === "key" ||
    column === "ttl" ||
    (column === "value" &&
      row.type === "string" &&
      !row.truncated &&
      typeof row.value === "string" &&
      !row.value.startsWith("\\x"))
  );
}

export function redisCellEditCommand(
  row: Record<string, unknown>,
  updates: Record<string, string | null>,
): string | null {
  const changed = Object.entries(updates).filter(([column, value]) => {
    const original = row[column];
    return (
      value !==
      (original == null
        ? null
        : typeof original === "object"
          ? JSON.stringify(original)
          : String(original))
    );
  });
  if (!changed.length) return null;
  if (changed.length !== 1) throw Error("Bitte eine Redis-Zelle nach der anderen bearbeiten.");
  const [column, value] = changed[0];
  if (!canEditRedisCell(row, column))
    throw Error(
      "Diese Redis-Zelle ist schreibgeschützt. Nutze Key verwalten für strukturierte oder gekürzte Werte.",
    );
  const key = quoteRedisArgument(String(row.key));
  if (column === "key") {
    if (value === null) throw Error("Ein Redis-Key kann nicht NULL sein.");
    return `RENAMENX ${key} ${quoteRedisArgument(value)}`;
  }
  if (column === "ttl") {
    if (value === null || value === "") return `PERSIST ${key}`;
    return redisActionCommand("expire", String(row.key), value, "");
  }
  if (value === null)
    throw Error("Ein Redis-String kann nicht NULL sein. Leerer Text ist erlaubt.");
  const script =
    "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return redis.error_reply('ERR Wert wurde zwischenzeitlich geändert. Bitte aktualisieren.') end return redis.call('SET',KEYS[1],ARGV[2],'XX','KEEPTTL')";
  return `EVAL ${quoteRedisArgument(script)} 1 ${key} ${quoteRedisArgument(String(row.value))} ${quoteRedisArgument(value)}`;
}
