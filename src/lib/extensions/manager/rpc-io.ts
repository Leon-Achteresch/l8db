import { matchesHost } from "../../../../packages/extension-api/src/manifest";
import type { FetchOptions, Json, QueryRequest } from "../contracts";
import { ExtensionError } from "../contracts";
import { HTTP_METHODS, isWriteQuery, SECRET_KEY_PATTERN } from "./is-write-query";
import type { RpcContext, RpcHandler } from "./rpc-context";

async function handleDatabaseActive(ctx: RpcContext): Promise<Json | void> {
  const { extension } = ctx;
  ctx.permissions.require(extension, "database:read");
  return structuredClone(ctx.core.database()) as unknown as Json;
}

async function handleDatabaseQuery(ctx: RpcContext): Promise<Json | void> {
  const { extension, args, text } = ctx;
  ctx.permissions.require(extension, "database:read");
  const sql = text(0, 32768);
  if (!sql.trim()) throw new ExtensionError("ProtocolError", "Empty query");
  const params = args[1] === undefined || args[1] === null ? undefined : args[1];
  if (
    params !== undefined &&
    (!Array.isArray(params) ||
      params.length > 100 ||
      !params.every(
        (p) =>
          typeof p === "string" || p === null || typeof p === "number" || typeof p === "boolean",
      ))
  )
    throw new ExtensionError("ProtocolError", "Invalid query params");
  const write = isWriteQuery(sql);
  if (write) ctx.permissions.require(extension, "database:write");
  const request: QueryRequest = {
    sql,
    params: params as (string | null)[] | undefined,
    write,
  };
  return (await ctx.core.query(request)) as unknown as Json;
}

async function handleNetworkFetch(ctx: RpcContext): Promise<Json | void> {
  const { extension, args, text } = ctx;
  ctx.permissions.require(extension, "network");
  const url = text(0, 8192);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExtensionError("ProtocolError", "Invalid URL");
  }
  if (parsed.protocol !== "https:")
    throw new ExtensionError("ProtocolError", "Only HTTPS URLs are allowed");
  const hosts = extension.archive.manifest.capabilities?.network?.hosts ?? [];
  if (!hosts.some((pattern) => matchesHost(parsed.host, pattern)))
    throw new ExtensionError("PermissionDeniedError", `Host not allowed: ${parsed.host}`);
  const raw = (args[1] ?? null) as unknown as FetchOptions | null;
  const options: FetchOptions = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (options.method !== undefined && !HTTP_METHODS.includes(options.method.toUpperCase()))
    throw new ExtensionError("ProtocolError", "Invalid fetch method");
  if (
    options.headers !== undefined &&
    (typeof options.headers !== "object" ||
      Array.isArray(options.headers) ||
      Object.entries(options.headers).length > 20 ||
      Object.entries(options.headers).some(
        ([k, v]) =>
          typeof k !== "string" || typeof v !== "string" || k.length > 256 || v.length > 4096,
      ))
  )
    throw new ExtensionError("ProtocolError", "Invalid fetch headers");
  if (
    options.body !== undefined &&
    (typeof options.body !== "string" || options.body.length > 262144)
  )
    throw new ExtensionError("ProtocolError", "Invalid fetch body");
  if (
    options.timeoutMs !== undefined &&
    (typeof options.timeoutMs !== "number" || options.timeoutMs < 1 || options.timeoutMs > 30000)
  )
    throw new ExtensionError("ProtocolError", "Invalid fetch timeout");
  return (await ctx.core.fetch({ url, options })) as unknown as Json;
}

async function handleSecretsGet(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, text, method } = ctx;
  ctx.permissions.require(extension, "filesystem:extension-storage");
  const key = text(0, 80);
  if (!SECRET_KEY_PATTERN.test(key))
    throw new ExtensionError("ProtocolError", "Invalid secret key");
  if (method === "secrets.get") return ctx.storage.secretGet(id, key);
  if (method === "secrets.delete") {
    await ctx.storage.secretDelete(id, key);
    return;
  }
  const value = text(1, 16384);
  await ctx.storage.secretSet(id, key, value);
  return;
}

async function handleClipboardRead(ctx: RpcContext): Promise<Json | void> {
  const { extension } = ctx;
  ctx.permissions.require(extension, "clipboard:read");
  return ctx.core.clipboardRead();
}

async function handleClipboardWrite(ctx: RpcContext): Promise<Json | void> {
  const { extension, text } = ctx;
  ctx.permissions.require(extension, "clipboard:write");
  await ctx.core.clipboardWrite(text(0, 262144));
  return;
}

async function handleWorkspaceShowopendialog(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, optionalText, method } = ctx;
  ctx.permissions.require(extension, "filesystem");
  const hint = optionalText(0, 256);
  const path =
    method === "workspace.showOpenDialog"
      ? await ctx.core.showOpenDialog(hint)
      : await ctx.core.showSaveDialog(hint);
  if (path) ctx.allowFs(id, path);
  return path;
}

async function handleWorkspaceReadfile(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, text } = ctx;
  ctx.permissions.require(extension, "filesystem");
  const path = text(0, 4096);
  ctx.requireFs(id, path);
  return ctx.core.readTextFile(path);
}

async function handleWorkspaceWritefile(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, text } = ctx;
  ctx.permissions.require(extension, "filesystem");
  const path = text(0, 4096);
  ctx.requireFs(id, path);
  await ctx.core.writeTextFile(path, text(1, 1048576));
  return;
}

export const rpcIoHandlers: Record<string, RpcHandler> = {
  "database.active": handleDatabaseActive,
  "database.query": handleDatabaseQuery,
  "network.fetch": handleNetworkFetch,
  "secrets.get": handleSecretsGet,
  "secrets.set": handleSecretsGet,
  "secrets.delete": handleSecretsGet,
  "clipboard.read": handleClipboardRead,
  "clipboard.write": handleClipboardWrite,
  "workspace.showOpenDialog": handleWorkspaceShowopendialog,
  "workspace.showSaveDialog": handleWorkspaceShowopendialog,
  "workspace.readFile": handleWorkspaceReadfile,
  "workspace.writeFile": handleWorkspaceWritefile,
};
