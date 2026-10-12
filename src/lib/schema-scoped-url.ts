const SCHEMA_KEYS = new Set(["schema", "search_path", "currentSchema"]);

function decodedKey(part: string): string {
  const key = part.split("=")[0];
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

export function schemaScopedConnectionString(connectionString: string, schema: string): string {
  const hashIndex = connectionString.indexOf("#");
  const base = hashIndex < 0 ? connectionString : connectionString.slice(0, hashIndex);
  const hash = hashIndex < 0 ? "" : connectionString.slice(hashIndex);
  const queryIndex = base.indexOf("?");
  const head = queryIndex < 0 ? base : base.slice(0, queryIndex);
  const params = queryIndex < 0 ? [] : base.slice(queryIndex + 1).split("&");
  const kept = params.filter((part) => part && !SCHEMA_KEYS.has(decodedKey(part)));
  kept.push(`schema=${encodeURIComponent(schema)}`);
  return `${head}?${kept.join("&")}${hash}`;
}
