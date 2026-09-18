import type { InputBoxOptions, Json, QuickPickOptions } from "../contracts";
import { ExtensionError } from "../contracts";
import type { RpcContext, RpcHandler } from "./rpc-context";

async function handleWindowShowquickpick(ctx: RpcContext): Promise<Json | void> {
  const { id, args } = ctx;
  const raw = args[0] as unknown;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200)
    throw new ExtensionError("ProtocolError", "Invalid quick pick items");
  const items = raw.map((entry) => {
    if (typeof entry === "string") {
      if (!entry || entry.length > 256)
        throw new ExtensionError("ProtocolError", "Invalid quick pick item");
      return { label: entry };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new ExtensionError("ProtocolError", "Invalid quick pick item");
    const item = entry as Record<string, Json>;
    if (typeof item.label !== "string" || !item.label || item.label.length > 256)
      throw new ExtensionError("ProtocolError", "Invalid quick pick item");
    return {
      label: item.label,
      description:
        typeof item.description === "string" ? item.description.slice(0, 256) : undefined,
      detail: typeof item.detail === "string" ? item.detail.slice(0, 512) : undefined,
      picked: item.picked === true,
    };
  });
  const rawOptions = (args[1] ?? null) as unknown as QuickPickOptions | null;
  const options: QuickPickOptions =
    rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions) ? rawOptions : {};
  const picked = await ctx.core.prompt({
    kind: "quickPick",
    extensionId: id,
    title: typeof options.title === "string" ? options.title.slice(0, 256) : undefined,
    placeholder:
      typeof options.placeholder === "string" ? options.placeholder.slice(0, 256) : undefined,
    canPickMany: options.canPickMany === true,
    items: items as { label: string }[],
  });
  if (picked === undefined) return;
  return items.filter((_, index) => (picked as number[]).includes(index)) as unknown as Json;
}

async function handleWindowShowinputbox(ctx: RpcContext): Promise<Json | void> {
  const { id, args } = ctx;
  const rawOptions = (args[0] ?? null) as unknown as InputBoxOptions | null;
  const options: InputBoxOptions =
    rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions) ? rawOptions : {};
  return (await ctx.core.prompt({
    kind: "inputBox",
    extensionId: id,
    title: typeof options.title === "string" ? options.title.slice(0, 256) : undefined,
    message: typeof options.prompt === "string" ? options.prompt.slice(0, 1024) : undefined,
    placeholder:
      typeof options.placeholder === "string" ? options.placeholder.slice(0, 256) : undefined,
    defaultValue: typeof options.value === "string" ? options.value.slice(0, 4096) : undefined,
    password: options.password === true,
  })) as Json;
}

async function handleWindowShowmessage(ctx: RpcContext): Promise<Json | void> {
  const { id, args, text } = ctx;
  const level = text(0, 16);
  if (!["info", "warning", "error"].includes(level))
    throw new ExtensionError("ProtocolError", "Invalid message level");
  const message = text(1);
  const actions = Array.isArray(args[2])
    ? (args[2] as Json[]).map((action) => {
        if (typeof action !== "string" || !action || action.length > 120)
          throw new ExtensionError("ProtocolError", "Invalid message action");
        return action;
      })
    : [];
  if (actions.length > 5) throw new ExtensionError("ProtocolError", "Too many actions");
  return (await ctx.core.prompt({
    kind: "message",
    extensionId: id,
    message,
    level: level as "info" | "warning" | "error",
    actions,
  })) as Json;
}

export const rpcWindowHandlers: Record<string, RpcHandler> = {
  "window.showQuickPick": handleWindowShowquickpick,
  "window.showInputBox": handleWindowShowinputbox,
  "window.showMessage": handleWindowShowmessage,
};
