import {
  storeSecret as persistSecret,
  loadSecret as readSecret,
  deleteSecret as removeSecret,
} from "@/lib/db";

const sessionSecrets = new Map<string, string>();

export async function storeSecret(account: string, secret: string): Promise<void> {
  sessionSecrets.set(account, secret);
  await persistSecret(account, secret);
}

export async function rememberSecret(account: string, secret: string): Promise<void> {
  sessionSecrets.set(account, secret);
  await removeSecret(account);
}

export function peekSecret(account: string): string | null {
  return sessionSecrets.get(account) ?? null;
}

export async function loadSecret(account: string): Promise<string | null> {
  const cached = sessionSecrets.get(account);
  if (cached !== undefined) return cached;
  const secret = await readSecret(account);
  if (secret !== null) sessionSecrets.set(account, secret);
  return secret;
}

export async function deleteSecret(account: string): Promise<void> {
  sessionSecrets.delete(account);
  await removeSecret(account);
}

const REDACTED_SECRET = "***";

interface KeyValueSecret {
  start: number;
  end: number;
  raw: string;
}

function keyValueSecrets(value: string, key: string): KeyValueSecret[] {
  const pattern = value.includes(";")
    ? new RegExp(
        `(^|;)(\\s*${key}\\s*=\\s*)(\\{(?:[^}]|\\}\\})*\\}|"(?:[^"]|"")*"|'[^']*'|[^;]*)`,
        "gi",
      )
    : new RegExp(`(^|\\s)(${key}\\s*=\\s*)('(?:[^'\\\\]|\\\\.)*'|\\S*)`, "gi");
  return [...value.matchAll(pattern)].map((match) => {
    const start = (match.index ?? 0) + match[1].length + match[2].length;
    return { start, end: start + match[3].length, raw: match[3] };
  });
}

function keyValueSecret(value: string): KeyValueSecret | null {
  return keyValueSecrets(value, "(?:password|pwd)")[0] ?? null;
}

function unquoteKeyValueSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("{") && trimmed.endsWith("}"))
    return trimmed.slice(1, -1).replace(/\}\}/g, "}");
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"'))
    return trimmed.slice(1, -1).replace(/""/g, '"');
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1);
  return trimmed;
}

function quoteKeyValueSecret(value: string, password: string): string {
  if (!value.includes(";")) {
    if (!/[\s'\\]/.test(password) && password !== "") return password;
    return `'${password.replace(/[\\']/g, "\\$&")}'`;
  }
  if (!/[;'"{}]|^\s|\s$/.test(password)) return password;
  if (/(^|;)\s*(?:driver|dsn)\s*=/i.test(value)) return `{${password.replace(/\}/g, "}}")}}`;
  return `"${password.replace(/"/g, '""')}"`;
}

export function extractUrlPassword(url: string): string | null {
  if (!url.includes("://")) {
    const secret = keyValueSecret(url);
    if (!secret) return null;
    const password = unquoteKeyValueSecret(secret.raw);
    return password && password !== REDACTED_SECRET ? password : null;
  }
  const scheme = url.indexOf("://");
  if (scheme < 0) return null;
  const rest = url.slice(scheme + 3);
  const authEnd = rest.search(/[/?#]/);
  const authority = authEnd < 0 ? rest : rest.slice(0, authEnd);
  const at = authority.lastIndexOf("@");
  if (at < 0) return null;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon < 0) return null;
  try {
    const password = decodeURIComponent(userinfo.slice(colon + 1));
    return password ? password : null;
  } catch {
    const password = userinfo.slice(colon + 1);
    return password ? password : null;
  }
}

export function scrubUrlPassword(url: string): string {
  if (!url.includes("://")) {
    const key = url.includes(";") ? "[^;=]*?(?:password|pwd)" : "[^\\s=]*?(?:password|pwd)";
    return keyValueSecrets(url, key).reduceRight(
      (scrubbed, secret) =>
        `${scrubbed.slice(0, secret.start)}${REDACTED_SECRET}${scrubbed.slice(secret.end)}`,
      url,
    );
  }
  const scheme = url.indexOf("://");
  if (scheme < 0) return url;
  const prefix = url.slice(0, scheme + 3);
  const rest = url.slice(scheme + 3);
  const authEnd = rest.search(/[/?#]/);
  const end = authEnd < 0 ? rest.length : authEnd;
  const authority = rest.slice(0, end);
  const tail = rest.slice(end);
  const at = authority.lastIndexOf("@");
  if (at < 0) return url;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon < 0) return url;
  return `${prefix}${userinfo.slice(0, colon)}${authority.slice(at)}${tail}`;
}

export function injectUrlPassword(redactedUrl: string, password: string): string {
  if (!password) return redactedUrl;
  if (!redactedUrl.includes("://")) {
    const secret = keyValueSecret(redactedUrl);
    if (!secret) return redactedUrl;
    return `${redactedUrl.slice(0, secret.start)}${quoteKeyValueSecret(redactedUrl, password)}${redactedUrl.slice(secret.end)}`;
  }
  const scheme = redactedUrl.indexOf("://");
  const prefix = redactedUrl.slice(0, scheme + 3);
  const rest = redactedUrl.slice(scheme + 3);
  const authEnd = rest.search(/[/?#]/);
  const end = authEnd < 0 ? rest.length : authEnd;
  const authority = rest.slice(0, end);
  const tail = rest.slice(end);
  const at = authority.lastIndexOf("@");
  if (at < 0) return redactedUrl;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  const user = colon < 0 ? userinfo : userinfo.slice(0, colon);
  return `${prefix}${user}:${encodeURIComponent(password)}${authority.slice(at)}${tail}`;
}

export function withSslModeParam(value: string, sslMode: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  const params = url.search
    .slice(1)
    .split("&")
    .filter((part) => part && decodeURIComponent(part.split("=")[0]) !== "sslmode");
  params.push(`sslmode=${encodeURIComponent(sslMode)}`);
  url.search = params.join("&");
  return url.toString();
}
