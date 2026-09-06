import { satisfies, valid, validRange } from "semver";
import type { ExtensionArchive, ExtensionManifest, Permission } from "./index";

export class ExtensionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = code;
  }
}
export const permissions: Permission[] = ["database:read", "database:write", "network", "filesystem:extension-storage", "filesystem", "clipboard:read", "clipboard:write", "process:execute"];
export const extensionIdPattern = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const commandPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
function fail(message: string): never { throw new ExtensionError("ManifestValidationError", message) }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) }
function string(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4096 }
export function safePath(path: string): boolean {
  return path.length <= 240 && /^[a-zA-Z0-9_./-]+$/.test(path) && path.split("/").every(part => !!part && part !== "." && part !== ".." && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part) && !part.endsWith("."));
}
export function validateManifest(value: unknown): ExtensionManifest {
  if (!object(value)) fail("Manifest must be an object");
  for (const key of ["id", "name", "version", "publisher", "main"]) if (!string(value[key])) fail(`Invalid ${key}`);
  if (((value.id as string).length > 160 || !extensionIdPattern.test(value.id as string)) || !(value.id as string).startsWith(`${value.publisher}.`)) fail("ID must be publisher.name");
  if (!valid(value.version as string)) fail("Invalid semantic version");
  if (!object(value.engines) || !string(value.engines.l8db) || !validRange(value.engines.l8db)) fail("Invalid engines.l8db range");
  if (value.engines.api !== undefined && value.engines.api !== "^1.0.0") fail("Unsupported API version");
  const main = (value.main as string).replace(/^\.\//, "");
  if (!safePath(main) || !main.endsWith(".js")) fail("main must be a safe relative JavaScript path");
  if (!Array.isArray(value.activationEvents) || value.activationEvents.length > 100 || !value.activationEvents.every(e => typeof e === "string" && (e === "onStartup" || e === "onDatabaseOpen" || (e.startsWith("onCommand:") && commandPattern.test(e.slice(10)))))) fail("Invalid activationEvents");
  if (value.permissions !== undefined && (!Array.isArray(value.permissions) || !value.permissions.every(p => permissions.includes(p)))) fail("Invalid permissions");
  if (value.dependencies !== undefined && (!object(value.dependencies) || !Object.entries(value.dependencies).every(([id, range]) => extensionIdPattern.test(id) && id !== value.id && string(range) && !!validRange(range)))) fail("Invalid dependencies");
  if (value.description !== undefined && !string(value.description)) fail("Invalid description");
  if (value.contributes !== undefined) {
    if (!object(value.contributes)) fail("Invalid contributes");
    if (Object.keys(value.contributes).some(k => !["commands", "configuration"].includes(k))) fail("Unsupported contribution type");
    const commands = value.contributes.commands;
    if (commands !== undefined && (!Array.isArray(commands) || commands.length > 100 || !commands.every(c => object(c) && string(c.id) && commandPattern.test(c.id) && string(c.title)))) fail("Invalid commands");
    if (Array.isArray(commands) && new Set(commands.map(c => c.id)).size !== commands.length) fail("Duplicate manifest command");
    const config = value.contributes.configuration;
    if (config !== undefined && (!object(config) || !Object.entries(config).every(([key, p]) => commandPattern.test(key) && object(p) && ["boolean", "number", "string"].includes(String(p.type)) && typeof p.default === p.type && (p.type !== "number" || Number.isFinite(p.default))))) fail("Invalid configuration");
  }
  const result = structuredClone(value) as unknown as ExtensionManifest;
  result.main = main;
  result.engines.api = "^1.0.0";
  for (const event of result.activationEvents) if (event.startsWith("onCommand:") && !result.contributes?.commands?.some(c => c.id === event.slice(10))) fail("Activation command must be contributed");
  return result;
}
export function assertCompatible(manifest: ExtensionManifest, hostVersion: string) {
  if (!satisfies(hostVersion, manifest.engines.l8db)) throw new ExtensionError("IncompatibleExtensionError", `${manifest.id} requires l8db ${manifest.engines.l8db}; host is ${hostVersion}`);
}
export function validateArchive(value: unknown): ExtensionArchive {
  if (!object(value) || value.format !== 1 || !object(value.files)) fail("Invalid archive format");
  const manifest = validateManifest(value.manifest);
  const entries = Object.entries(value.files);
  if (entries.length > 256 || entries.some(([path, content]) => !safePath(path) || typeof content !== "string")) fail("Invalid archive files");
  if (typeof value.files[manifest.main] !== "string") fail("Missing entry point");
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024) fail("Archive exceeds 8 MiB");
  return { format: 1, manifest, files: value.files as Record<string, string> };
}
