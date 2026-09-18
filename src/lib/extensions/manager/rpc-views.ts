import type { Json, StatusBarUpdate, TreeItem } from "../contracts";
import { ExtensionError } from "../contracts";
import { validateTreeItems } from "../registries";
import type { RpcContext, RpcHandler } from "./rpc-context";

async function handleViewsSettree(ctx: RpcContext): Promise<Json | void> {
  const { id, args, text } = ctx;
  const viewId = text(0, 128);
  if (ctx.views.owner(viewId) !== id) throw new ExtensionError("ViewNotFoundError", viewId);
  const items = args[1] as unknown as TreeItem[];
  validateTreeItems(items);
  ctx.views.setTree(id, viewId, structuredClone(items) as TreeItem[]);
  ctx.changed();
  return;
}

async function handleViewsReveal(ctx: RpcContext): Promise<Json | void> {
  const { id, text } = ctx;
  const viewId = text(0, 128);
  if (ctx.views.owner(viewId) !== id) throw new ExtensionError("ViewNotFoundError", viewId);
  await ctx.trigger(`onView:${viewId}`);
  ctx.changed();
  return;
}

async function handleStatusbarSet(ctx: RpcContext): Promise<Json | void> {
  const { id, args, text } = ctx;
  const itemId = text(0, 128);
  if (ctx.statusBar.owner(itemId) !== id)
    throw new ExtensionError("StatusBarNotFoundError", itemId);
  const raw = args[1] as unknown as StatusBarUpdate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ExtensionError("ProtocolError", "Invalid status bar update");
  if (raw.command) {
    const owner = ctx.commands.owner(raw.command);
    if (owner !== id) throw new ExtensionError("CommandNotFoundError", raw.command);
  }
  ctx.statusBar.set(id, itemId, {
    text: String(raw.text ?? ""),
    tooltip: typeof raw.tooltip === "string" ? raw.tooltip.slice(0, 512) : undefined,
    command: typeof raw.command === "string" && raw.command ? raw.command : undefined,
    background:
      raw.background === "info" || raw.background === "warning" || raw.background === "error"
        ? raw.background
        : undefined,
  });
  ctx.changed();
  return;
}

async function handleStatusbarHide(ctx: RpcContext): Promise<Json | void> {
  const { id, text } = ctx;
  const itemId = text(0, 128);
  ctx.statusBar.hide(id, itemId);
  ctx.changed();
  return;
}

async function handlePanelsOpen(ctx: RpcContext): Promise<Json | void> {
  const { id, args, text } = ctx;
  const panelId = text(0, 128);
  const html = args[1] === undefined || args[1] === null ? "" : text(1, 262144);
  ctx.panels.open(id, panelId, html);
  ctx.changed();
  return;
}

async function handlePanelsClose(ctx: RpcContext): Promise<Json | void> {
  const { id, text } = ctx;
  ctx.panels.close(id, text(0, 128));
  ctx.changed();
  return;
}

async function handlePanelsPostmessage(ctx: RpcContext): Promise<Json | void> {
  const { id, args, text } = ctx;
  ctx.panels.postToWebview(id, text(0, 128), args[1] ?? null);
  return;
}

async function handlePanelsOnmessage(ctx: RpcContext): Promise<Json | void> {
  const { id, text, resources } = ctx;
  const panelId = text(0, 128);
  if (ctx.panels.owner(panelId) !== id) throw new ExtensionError("PanelNotFoundError", panelId);
  const key = `webview:${panelId}`;
  if (!resources.has(key))
    resources.set(
      key,
      ctx.panels.incoming.on(`${id}:${panelId}`, (message) =>
        ctx.runtime.event(id, `webview:message:${panelId}`, message),
      ),
    );
  return;
}

export const rpcViewsHandlers: Record<string, RpcHandler> = {
  "views.setTree": handleViewsSettree,
  "views.reveal": handleViewsReveal,
  "statusBar.set": handleStatusbarSet,
  "statusBar.hide": handleStatusbarHide,
  "panels.open": handlePanelsOpen,
  "panels.close": handlePanelsClose,
  "panels.postMessage": handlePanelsPostmessage,
  "panels.onMessage": handlePanelsOnmessage,
};
