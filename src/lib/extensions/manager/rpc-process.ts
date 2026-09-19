import type { Json, ProcessOptions } from "../contracts";
import { ExtensionError } from "../contracts";
import type { RpcContext, RpcHandler } from "./rpc-context";

async function handleProcessRun(ctx: RpcContext): Promise<Json | void> {
  const { extension, args, text } = ctx;
  ctx.permissions.require(extension, "process:execute");
  const command = text(0, 64);
  const allowed = extension.archive.manifest.capabilities?.process?.commands ?? [];
  if (!allowed.includes(command))
    throw new ExtensionError("PermissionDeniedError", `Command not allowed: ${command}`);
  const raw = (args[1] ?? null) as unknown as ProcessOptions | null;
  const options: ProcessOptions = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (
    options.args !== undefined &&
    (!Array.isArray(options.args) ||
      options.args.length > 50 ||
      !options.args.every((a) => typeof a === "string" && a.length <= 4096))
  )
    throw new ExtensionError("ProtocolError", "Invalid process args");
  if (options.cwd !== undefined && (typeof options.cwd !== "string" || options.cwd.length > 4096))
    throw new ExtensionError("ProtocolError", "Invalid process cwd");
  if (
    options.env !== undefined &&
    (typeof options.env !== "object" ||
      Array.isArray(options.env) ||
      Object.entries(options.env).length > 20 ||
      Object.entries(options.env).some(
        ([k, v]) =>
          typeof k !== "string" || typeof v !== "string" || k.length > 256 || v.length > 4096,
      ))
  )
    throw new ExtensionError("ProtocolError", "Invalid process env");
  if (
    options.timeoutMs !== undefined &&
    (typeof options.timeoutMs !== "number" || options.timeoutMs < 1 || options.timeoutMs > 120000)
  )
    throw new ExtensionError("ProtocolError", "Invalid process timeout");
  return (await ctx.core.runProcess({ command, options })) as unknown as Json;
}

export const rpcProcessHandlers: Record<string, RpcHandler> = {
  "process.run": handleProcessRun,
};
