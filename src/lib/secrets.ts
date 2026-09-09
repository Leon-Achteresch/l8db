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

function unquoteOracleSecret(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

export function extractUrlPassword(url: string): string | null {
  if (!url.includes("://")) {
    const match = /(?:password|pwd)\s*=\s*("[^"]*"|'[^']*'|[^;]*)/i.exec(url);
    if (!match) return null;
    const password = unquoteOracleSecret(match[1]);
    return password ? password : null;
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
  if (!url.includes("://"))
    return url.replace(/((?:password|pwd)\s*=\s*)("[^"]*"|'[^']*'|[^;]*)/gi, "$1***");
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
  const scheme = redactedUrl.indexOf("://");
  if (scheme < 0 || !password) return redactedUrl;
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
  if (colon >= 0 && userinfo.slice(colon + 1)) return redactedUrl;
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
