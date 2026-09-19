import type { ExtensionEvents } from "../../../../packages/extension-api/src";
import { safePath } from "../../../../packages/extension-api/src/manifest";
import type { Json } from "../contracts";
import { ExtensionError } from "../contracts";
import type { RpcContext, RpcHandler } from "./rpc-context";

async function handleCommandsRegister(ctx: RpcContext): Promise<Json | void> {
  const { id, text, resources } = ctx;
  const command = text(0, 128);
  const resource = ctx.commands.register(id, command, (payload) =>
    ctx.runtime.execute(id, command, payload),
  );
  resources.set(`command:${command}`, resource);
  return;
}

async function handleCommandsList(ctx: RpcContext): Promise<Json | void> {
  return ctx.commands.list() as unknown as Json;
}

async function handleDispose(ctx: RpcContext): Promise<Json | void> {
  const { text, resources } = ctx;
  const key = text(0, 256);
  resources.get(key)?.dispose();
  resources.delete(key);
  return;
}

async function handleCommandsExecute(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, args, text } = ctx;
  const command = text(0, 128);
  const owner = ctx.commands.owner(command);
  if (owner !== id && !Object.hasOwn(extension.archive.manifest.dependencies ?? {}, owner ?? ""))
    throw new ExtensionError(
      "PermissionDeniedError",
      "Cross-extension commands require a declared dependency",
    );
  if (ctx.registry.get(owner ?? "").state !== "activated")
    throw new ExtensionError(
      "ExtensionActivationError",
      "Commands invoked by extensions require an activated target",
    );
  return ctx.commands.execute(command, args[1]);
}

async function handleEventsOn(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, text, resources } = ctx;
  ctx.permissions.require(extension, "database:read");
  const event = text(0, 64);
  if (event !== "databaseOpened" && event !== "databaseClosed" && event !== "activeDatabaseChanged")
    throw new ExtensionError("ProtocolError", "Unknown event");
  const key = `event:${event}`;
  if (!resources.has(key))
    resources.set(
      key,
      ctx.events.on(event as keyof ExtensionEvents, (value) =>
        ctx.runtime.event(id, event, value as unknown as Json),
      ),
    );
  return;
}

async function handleConfigurationOndidchange(ctx: RpcContext): Promise<Json | void> {
  const { resources } = ctx;
  const key = "config-changed";
  if (!resources.has(key))
    resources.set(key, {
      dispose: () => undefined,
    });
  return;
}

async function handleNotificationsShow(ctx: RpcContext): Promise<Json | void> {
  const { id, args, text } = ctx;
  const level = text(0, 16);
  if (!["info", "warn", "error"].includes(level))
    throw new ExtensionError("ProtocolError", "Invalid notification level");
  const message = text(1);
  const actions = Array.isArray(args[2])
    ? (args[2] as Json[]).map((action, index) => {
        if (typeof action !== "string" || action.length === 0 || action.length > 120)
          throw new ExtensionError("ProtocolError", `Invalid action ${index}`);
        return action;
      })
    : [];
  if (actions.length > 5) throw new ExtensionError("ProtocolError", "Too many actions");
  if (!actions.length) {
    ctx.core.notify(message);
    return;
  }
  return (await ctx.core.prompt({
    kind: "message",
    extensionId: id,
    message,
    level: level === "warn" ? "warning" : (level as "info" | "error"),
    actions,
  })) as Json;
}

async function handleAssetsReadtext(ctx: RpcContext): Promise<Json | void> {
  const { extension, text } = ctx;
  const path = text(0, 240);
  if (!safePath(path) || !Object.hasOwn(extension.archive.files, path))
    throw new ExtensionError("AssetNotFoundError", path);
  return extension.archive.files[path];
}

async function handleConfigurationGet(ctx: RpcContext): Promise<Json | void> {
  const { extension, text } = ctx;
  return ctx.configuration.get(extension, text(0, 128));
}

async function handleStorageGet(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, args, text, method } = ctx;
  ctx.permissions.require(extension, "filesystem:extension-storage");
  const key = text(0);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key))
    throw new ExtensionError("ProtocolError", "Invalid storage key");
  if (method === "storage.get") return ctx.storage.get(id, key);
  return ctx.storage.set(id, key, args[1] ?? null);
}

async function handleLogger(ctx: RpcContext): Promise<Json | void> {
  const { id, text } = ctx;
  const level = text(0);
  if (!["info", "warn", "error"].includes(level))
    throw new ExtensionError("ProtocolError", "Invalid log level");
  ctx.log(id, level, text(1));
  return;
}

export const rpcCoreHandlers: Record<string, RpcHandler> = {
  "commands.register": handleCommandsRegister,
  "commands.list": handleCommandsList,
  dispose: handleDispose,
  "commands.execute": handleCommandsExecute,
  "events.on": handleEventsOn,
  "configuration.onDidChange": handleConfigurationOndidchange,
  "notifications.show": handleNotificationsShow,
  "assets.readText": handleAssetsReadtext,
  "configuration.get": handleConfigurationGet,
  "storage.get": handleStorageGet,
  "storage.set": handleStorageGet,
  logger: handleLogger,
};
