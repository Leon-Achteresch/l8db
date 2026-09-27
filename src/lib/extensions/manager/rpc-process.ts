import type { Json, ProcessOptions } from "../contracts";
import { ExtensionError } from "../contracts";
import type { RpcContext, RpcHandler } from "./rpc-context";

function processRequest(ctx: RpcContext) {
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
    (typeof options.timeoutMs !== "number" || options.timeoutMs < 1 || options.timeoutMs > 600000)
  )
    throw new ExtensionError("ProtocolError", "Invalid process timeout");
  return { command, options };
}

function ownedSession(ctx: RpcContext) {
  ctx.permissions.require(ctx.extension, "process:execute");
  const id = ctx.args[0];
  if (typeof id !== "number" || !ctx.resources.has(`process:${id}`))
    throw new ExtensionError("ProtocolError", "Unknown process");
  return id;
}

async function handleProcessRun(ctx: RpcContext): Promise<Json | void> {
  return (await ctx.core.runProcess(processRequest(ctx))) as unknown as Json;
}

async function handleProcessStart(ctx: RpcContext): Promise<Json | void> {
  const id = await ctx.core.startProcess(processRequest(ctx));
  ctx.resources.set(`process:${id}`, { dispose: () => void ctx.core.stopProcess(id) });
  return id;
}

async function handleProcessWrite(ctx: RpcContext): Promise<Json | void> {
  const id = ownedSession(ctx);
  await ctx.core.writeProcess(id, ctx.text(1, 4096));
}

async function handleProcessRead(ctx: RpcContext): Promise<Json | void> {
  const id = ownedSession(ctx);
  const timeout = ctx.args[1];
  const output = await ctx.core.readProcess(
    id,
    typeof timeout === "number" ? Math.min(Math.max(timeout, 1), 30000) : 1000,
  );
  if (output.exited) ctx.resources.delete(`process:${id}`);
  return output as unknown as Json;
}

async function handleProcessStop(ctx: RpcContext): Promise<Json | void> {
  const id = ownedSession(ctx);
  ctx.resources.delete(`process:${id}`);
  await ctx.core.stopProcess(id);
}

export const rpcProcessHandlers: Record<string, RpcHandler> = {
  "process.run": handleProcessRun,
  "process.start": handleProcessStart,
  "process.write": handleProcessWrite,
  "process.read": handleProcessRead,
  "process.stop": handleProcessStop,
};
