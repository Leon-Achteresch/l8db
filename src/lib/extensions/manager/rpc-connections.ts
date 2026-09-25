import type { Json, VaultConnection } from "../../../../packages/extension-api/src";
import { ExtensionError } from "../contracts";
import type { RpcContext, RpcHandler } from "./rpc-context";

async function handleConnectionsList(ctx: RpcContext): Promise<Json | void> {
  ctx.permissions.require(ctx.extension, "connections:read");
  return (await ctx.core.listConnections()) as unknown as Json;
}

async function handleConnectionsSave(ctx: RpcContext): Promise<Json | void> {
  ctx.permissions.require(ctx.extension, "connections:write");
  const items = ctx.args[0];
  if (!Array.isArray(items) || items.length > 500)
    throw new ExtensionError("ProtocolError", "Invalid connections");
  const result = await ctx.core.saveConnections(items as unknown as VaultConnection[]);
  ctx.log(ctx.id, "info", `connections saved: +${result.added} ~${result.updated}`);
  return result as unknown as Json;
}

export const rpcConnectionsHandlers: Record<string, RpcHandler> = {
  "connections.list": handleConnectionsList,
  "connections.save": handleConnectionsSave,
};
