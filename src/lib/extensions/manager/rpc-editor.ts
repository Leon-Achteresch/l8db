import type { Json } from "../contracts";
import { ExtensionError } from "../contracts";
import type { RpcContext, RpcHandler } from "./rpc-context";

async function handleEditorGetText(ctx: RpcContext): Promise<Json | void> {
  ctx.permissions.require(ctx.extension, "editor:read");
  return ctx.editors.read(ctx.text(0, 128)) as unknown as Json;
}

async function handleEditorOnDidChangeText(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, resources } = ctx;
  ctx.permissions.require(extension, "editor:read");
  const key = "editor:text";
  if (!resources.has(key))
    resources.set(
      key,
      ctx.editors.subscribe(id, (event) =>
        ctx.runtime.event(id, "editorTextChanged", event as unknown as Json),
      ),
    );
  return;
}

async function handleEditorSetHiddenRanges(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, args, text } = ctx;
  ctx.permissions.require(extension, "editor:read");
  ctx.editors.setHidden(id, text(0, 128), args[1], args[2]);
  return;
}

async function handleEditorClearHiddenRanges(ctx: RpcContext): Promise<Json | void> {
  const { extension, id, text } = ctx;
  ctx.permissions.require(extension, "editor:read");
  ctx.editors.clearHidden(id, text(0, 128));
  return;
}

async function handleCommandsSetChecked(ctx: RpcContext): Promise<Json | void> {
  const { id, args, text } = ctx;
  const command = text(0, 128);
  const editorId = text(1, 128);
  if (
    ctx.commands.owner(command) !== id ||
    !ctx.commands.menusFor("editor/toolbar").some((menu) => menu.command === command)
  )
    throw new ExtensionError("CommandNotFoundError", command);
  if (typeof args[2] !== "boolean") throw new ExtensionError("ProtocolError", "Expected boolean");
  ctx.editors.setChecked(id, command, editorId, args[2]);
  return;
}

export const rpcEditorHandlers: Record<string, RpcHandler> = {
  "editor.getText": handleEditorGetText,
  "editor.onDidChangeText": handleEditorOnDidChangeText,
  "editor.setHiddenRanges": handleEditorSetHiddenRanges,
  "editor.clearHiddenRanges": handleEditorClearHiddenRanges,
  "commands.setChecked": handleCommandsSetChecked,
};
