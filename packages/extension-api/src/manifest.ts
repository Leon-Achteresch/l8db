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
export const apiVersions = ["^1.0.0", "^1.1.0"];
const commandPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const iconPattern = /^[a-z][a-z0-9-]{0,63}$/;
const hostPattern = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(:[0-9]{1,5})?$/;
const binaryPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
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
  if (value.engines.api !== undefined && !apiVersions.includes(value.engines.api as string)) fail("Unsupported API version");
  const main = (value.main as string).replace(/^\.\//, "");
  if (!safePath(main) || !main.endsWith(".js")) fail("main must be a safe relative JavaScript path");
  const activationEvent = (e: unknown) => typeof e === "string" && (e === "onStartup" || e === "onDatabaseOpen" || (e.startsWith("onCommand:") && commandPattern.test(e.slice(10))) || (e.startsWith("onView:") && commandPattern.test(e.slice(7))));
  if (!Array.isArray(value.activationEvents) || value.activationEvents.length > 100 || !value.activationEvents.every(activationEvent)) fail("Invalid activationEvents");
  if (value.permissions !== undefined && (!Array.isArray(value.permissions) || !value.permissions.every(p => permissions.includes(p)))) fail("Invalid permissions");
  if (value.dependencies !== undefined && (!object(value.dependencies) || !Object.entries(value.dependencies).every(([id, range]) => extensionIdPattern.test(id) && id !== value.id && string(range) && !!validRange(range)))) fail("Invalid dependencies");
  if (value.description !== undefined && !string(value.description)) fail("Invalid description");
  if (value.contributes !== undefined) {
    if (!object(value.contributes)) fail("Invalid contributes");
    if (Object.keys(value.contributes).some(k => !["commands", "configuration", "views", "panels", "statusBar", "menus"].includes(k))) fail("Unsupported contribution type");
    const commands = value.contributes.commands;
    if (commands !== undefined && (!Array.isArray(commands) || commands.length > 100 || !commands.every(c => object(c) && string(c.id) && commandPattern.test(c.id) && string(c.title) && (c.icon === undefined || (typeof c.icon === "string" && iconPattern.test(c.icon)))))) fail("Invalid commands");
    if (Array.isArray(commands) && new Set(commands.map(c => c.id)).size !== commands.length) fail("Duplicate manifest command");
    const config = value.contributes.configuration;
    const validProperty = (p: unknown) => object(p) && ["boolean", "number", "string"].includes(String(p.type)) && typeof p.default === p.type && (p.type !== "number" || Number.isFinite(p.default)) && (p.enum === undefined || (Array.isArray(p.enum) && p.enum.length > 0 && p.enum.length <= 50 && p.enum.every(e => typeof e === p.type))) && (p.description === undefined || string(p.description));
    if (config !== undefined && (!object(config) || Object.keys(config).length > 100 || !Object.entries(config).every(([key, p]) => commandPattern.test(key) && validProperty(p)))) fail("Invalid configuration");
    const views = value.contributes.views;
    if (views !== undefined && (!Array.isArray(views) || views.length > 20 || !views.every(v => object(v) && string(v.id) && commandPattern.test(v.id) && string(v.title) && (v.location === "sidebar" || v.location === "panel") && (v.icon === undefined || (typeof v.icon === "string" && iconPattern.test(v.icon)))))) fail("Invalid views");
    if (Array.isArray(views) && new Set(views.map(v => (v as { id: string }).id)).size !== views.length) fail("Duplicate manifest view");
    const panels = value.contributes.panels;
    if (panels !== undefined && (!Array.isArray(panels) || panels.length > 20 || !panels.every(p => object(p) && string(p.id) && commandPattern.test(p.id) && string(p.title)))) fail("Invalid panels");
    if (Array.isArray(panels) && new Set(panels.map(p => (p as { id: string }).id)).size !== panels.length) fail("Duplicate manifest panel");
    const statusBar = value.contributes.statusBar;
    if (statusBar !== undefined && (!Array.isArray(statusBar) || statusBar.length > 20 || !statusBar.every(s => object(s) && string(s.id) && commandPattern.test(s.id) && (s.alignment === undefined || s.alignment === "left" || s.alignment === "right") && (s.priority === undefined || (typeof s.priority === "number" && Number.isFinite(s.priority)))))) fail("Invalid statusBar");
    if (Array.isArray(statusBar) && new Set(statusBar.map(s => (s as { id: string }).id)).size !== statusBar.length) fail("Duplicate manifest statusBar item");
    const menus = value.contributes.menus;
    const menuLocations = ["palette", "view/title", "view/item", "statusBar"];
    if (menus !== undefined && (!Array.isArray(menus) || menus.length > 100 || !menus.every(m => object(m) && string(m.command) && commandPattern.test(m.command) && menuLocations.includes(String(m.location)) && (m.view === undefined || (string(m.view) && commandPattern.test(m.view))) && (m.group === undefined || string(m.group))))) fail("Invalid menus");
  }
  if (value.capabilities !== undefined) {
    if (!object(value.capabilities)) fail("Invalid capabilities");
    if (Object.keys(value.capabilities).some(k => !["network", "process"].includes(k))) fail("Unsupported capability");
    const network = (value.capabilities as Record<string, unknown>).network;
    if (network !== undefined && (!object(network) || !Array.isArray(network.hosts) || network.hosts.length > 50 || !network.hosts.every(h => typeof h === "string" && h.length > 0 && h.length <= 253 && hostPattern.test(h)))) fail("Invalid network capability");
    const proc = (value.capabilities as Record<string, unknown>).process;
    if (proc !== undefined && (!object(proc) || !Array.isArray(proc.commands) || proc.commands.length > 50 || !proc.commands.every(c => typeof c === "string" && binaryPattern.test(c)))) fail("Invalid process capability");
  }
  const result = structuredClone(value) as unknown as ExtensionManifest;
  result.main = main;
  if (result.engines.api === undefined) result.engines.api = "^1.0.0";
  for (const event of result.activationEvents) {
    if (event.startsWith("onCommand:") && !result.contributes?.commands?.some(c => c.id === event.slice(10))) fail("Activation command must be contributed");
    if (event.startsWith("onView:") && !result.contributes?.views?.some(v => v.id === event.slice(7))) fail("Activation view must be contributed");
  }
  for (const menu of result.contributes?.menus ?? []) {
    if (!result.contributes?.commands?.some(c => c.id === menu.command)) fail("Menu command must be contributed");
    if ((menu.location === "view/title" || menu.location === "view/item") && (!menu.view || !result.contributes?.views?.some(v => v.id === menu.view))) fail("View menu must reference a contributed view");
  }
  return result;
}
export function matchesHost(hostname: string, pattern: string): boolean {
  const [patternHost, patternPort] = splitHostPort(pattern);
  const [name, port] = splitHostPort(hostname.toLowerCase());
  if (patternPort !== undefined && port !== patternPort) return false;
  const host = patternHost.toLowerCase();
  if (host.startsWith("*.")) return name.length > host.length - 1 && name.endsWith(host.slice(1));
  return name === host;
}
function splitHostPort(value: string): [string, string | undefined] {
  const index = value.lastIndexOf(":");
  if (index < 0) return [value, undefined];
  return [value.slice(0, index), value.slice(index + 1)];
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
