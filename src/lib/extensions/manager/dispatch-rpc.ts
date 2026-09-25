import type { Disposable, ExtensionDescriptor, Json } from "../contracts";
import { ExtensionError } from "../contracts";
import { rpcConnectionsHandlers } from "./rpc-connections";
import type { RpcDeps, RpcHandler } from "./rpc-context";
import { rpcCoreHandlers } from "./rpc-core";
import { rpcIoHandlers } from "./rpc-io";
import { rpcProcessHandlers } from "./rpc-process";
import { rpcViewsHandlers } from "./rpc-views";
import { rpcWindowHandlers } from "./rpc-window";

const RPC_HANDLERS: Record<string, RpcHandler> = {
  ...rpcCoreHandlers,
  ...rpcConnectionsHandlers,
  ...rpcIoHandlers,
  ...rpcProcessHandlers,
  ...rpcWindowHandlers,
  ...rpcViewsHandlers,
};

export async function dispatchRpc(
  extension: ExtensionDescriptor,
  method: string,
  args: Json[],
  sessions: Map<string, Map<string, Disposable>>,
  deps: RpcDeps,
): Promise<Json | void> {
  const id = extension.archive.manifest.id;
  if ((!extension.enabled && method !== "logger" && method !== "dispose") || !sessions.has(id))
    throw new ExtensionError("ExtensionDisabledError", id);
  if (!Array.isArray(args)) throw new ExtensionError("ProtocolError", "Invalid RPC arguments");
  const limit =
    method === "connections.save"
      ? 2000000
      : method === "panels.open"
        ? 300000
        : method === "views.setTree"
          ? 280000
          : 65536;
  if (JSON.stringify(args).length > limit)
    throw new ExtensionError("ProtocolError", "Invalid RPC arguments");
  const text = (index: number, max = 4096) => {
    if (typeof args[index] !== "string" || (args[index] as string).length > max)
      throw new ExtensionError("ProtocolError", "Expected string");
    return args[index] as string;
  };
  const optionalText = (index: number, max = 4096) => {
    if (args[index] === undefined || args[index] === null) return undefined;
    return text(index, max);
  };
  const resources = sessions.get(id)!;
  if (!Object.hasOwn(RPC_HANDLERS, method))
    throw new ExtensionError("PermissionDeniedError", `API method unavailable: ${method}`);
  return RPC_HANDLERS[method]({
    ...deps,
    extension,
    id,
    method,
    args,
    text,
    optionalText,
    resources,
  });
}
