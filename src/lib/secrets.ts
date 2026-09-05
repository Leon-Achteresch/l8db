import { invoke } from "@tauri-apps/api/core"

export async function storeSecret(account: string, secret: string): Promise<void> {
  await invoke("store_secret", { account, secret })
}

export async function loadSecret(account: string): Promise<string | null> {
  return invoke("load_secret", { account })
}

export async function deleteSecret(account: string): Promise<void> {
  await invoke("delete_secret", { account })
}

export function extractUrlPassword(url: string): string | null {
  const scheme = url.indexOf("://")
  if (scheme < 0) return null
  const rest = url.slice(scheme + 3)
  const authEnd = rest.search(/[\/?#]/)
  const authority = authEnd < 0 ? rest : rest.slice(0, authEnd)
  const at = authority.lastIndexOf("@")
  if (at < 0) return null
  const userinfo = authority.slice(0, at)
  const colon = userinfo.indexOf(":")
  if (colon < 0) return null
  try {
    return decodeURIComponent(userinfo.slice(colon + 1))
  } catch {
    return userinfo.slice(colon + 1)
  }
}

export function scrubUrlPassword(url: string): string {
  const scheme = url.indexOf("://")
  if (scheme < 0) return url
  const prefix = url.slice(0, scheme + 3)
  const rest = url.slice(scheme + 3)
  const authEnd = rest.search(/[\/?#]/)
  const end = authEnd < 0 ? rest.length : authEnd
  const authority = rest.slice(0, end)
  const tail = rest.slice(end)
  const at = authority.lastIndexOf("@")
  if (at < 0) return url
  const userinfo = authority.slice(0, at)
  const colon = userinfo.indexOf(":")
  if (colon < 0) return url
  return `${prefix}${userinfo.slice(0, colon)}${authority.slice(at)}${tail}`
}

export function injectUrlPassword(redactedUrl: string, password: string): string {
  const scheme = redactedUrl.indexOf("://")
  if (scheme < 0 || !password) return redactedUrl
  const prefix = redactedUrl.slice(0, scheme + 3)
  const rest = redactedUrl.slice(scheme + 3)
  const authEnd = rest.search(/[\/?#]/)
  const end = authEnd < 0 ? rest.length : authEnd
  const authority = rest.slice(0, end)
  const tail = rest.slice(end)
  const at = authority.lastIndexOf("@")
  if (at < 0) return redactedUrl
  if (authority.slice(0, at).includes(":")) return redactedUrl
  return `${prefix}${authority.slice(0, at)}:${encodeURIComponent(password)}${authority.slice(at)}${tail}`
}

export function withSslModeParam(url: string, sslMode: string): string {
  if (!url || sslMode === "prefer" || /[?&]sslmode=/i.test(url)) return url
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}sslmode=${sslMode}`
}
