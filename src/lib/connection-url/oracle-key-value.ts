import {
  NON_ORACLE_KEYS,
  ORACLE_PASSWORD_KEYS,
  ORACLE_SOURCE_KEYS,
  ORACLE_USER_KEYS,
  PATH_LIKE,
} from "./constants";

export interface OracleKeyValue {
  user: string;
  password: string;
  source: string;
}

export interface OracleEndpoint {
  host: string;
  port: string;
  service: string;
}

function splitOraclePairs(value: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  let key = "";
  let current = "";
  let inKey = true;
  let quote: string | null = null;
  const flush = () => {
    pairs.push([key, current]);
    key = "";
    current = "";
    inKey = true;
  };
  for (const char of value) {
    if (char === '"' || char === "'") {
      quote = quote === char ? null : (quote ?? char);
      current += char;
    } else if (char === ";" && !quote) {
      flush();
    } else if (char === "=" && inKey) {
      inKey = false;
    } else if (inKey) {
      key += char;
    } else {
      current += char;
    }
  }
  flush();
  return pairs;
}

function unquoteOracle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'"))
      return trimmed.slice(1, -1);
  }
  return trimmed;
}

const compactOracleKey = (key: string) => key.trim().toLowerCase().replace(/\s+/g, "");

export function parseOracleKeyValue(value: string): OracleKeyValue | null {
  const trimmed = value.trim();
  if (!trimmed.includes("=") || !trimmed.includes(";")) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || PATH_LIKE.test(trimmed)) return null;
  const raw = splitOraclePairs(trimmed).filter(([key, val]) => key.trim() || val.trim());
  if (raw.length < 2) return null;
  let user = "";
  let password = "";
  let source = "";
  let sawUser = false;
  let sawSource = false;
  for (const [rawKey, rawVal] of raw) {
    const key = compactOracleKey(rawKey);
    if (!key) return null;
    if (NON_ORACLE_KEYS.includes(key)) return null;
    if (ORACLE_USER_KEYS.includes(key)) {
      user = unquoteOracle(rawVal);
      sawUser = true;
    } else if (ORACLE_PASSWORD_KEYS.includes(key)) {
      password = unquoteOracle(rawVal);
    } else if (ORACLE_SOURCE_KEYS.includes(key)) {
      source = unquoteOracle(rawVal);
      sawSource = true;
    }
  }
  if (!sawSource || !sawUser) return null;
  return { user, password, source };
}

function oracleSourceIsOracleLike(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("(") || trimmed.startsWith("/")) return true;
  if (trimmed.includes("/")) return true;
  if (/^\[[^\]]+\](?::\d+)?(?::|\/)/.test(trimmed)) return true;
  if (/:[0-9]{1,5}\//.test(trimmed) || /:[0-9]{1,5}:/.test(trimmed)) return true;
  return /service_name|sid\s*=|description\s*=/i.test(trimmed);
}

export function isOracleKeyValue(value: string): boolean {
  const parsed = parseOracleKeyValue(value);
  return parsed !== null && oracleSourceIsOracleLike(parsed.source);
}
