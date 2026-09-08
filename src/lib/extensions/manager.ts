import { gt, satisfies } from "semver";
import type { ExtensionEvents } from "../../../packages/extension-api/src";
import {
  matchesHost,
  safePath,
  validateArchive,
} from "../../../packages/extension-api/src/manifest";
import type {
  CoreServices,
  Disposable,
  ExtensionArchive,
  ExtensionDescriptor,
  ExtensionRuntime,
  ExtensionStorage,
  FetchOptions,
  InputBoxOptions,
  Json,
  PanelSnapshot,
  Permission,
  ProcessOptions,
  QueryRequest,
  QuickPickOptions,
  StatusBarSnapshot,
  StatusBarUpdate,
  TreeItem,
  ViewSnapshot,
} from "./contracts";
import { ExtensionError } from "./contracts";
import { ExtensionLoader } from "./loader";
import {
  CommandRegistry,
  ConfigurationRegistry,
  EventBus,
  ExtensionRegistry,
  PanelRegistry,
  PermissionManager,
  StatusBarRegistry,
  ViewRegistry,
  validateTreeItems,
} from "./registries";

const SECRET_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function isWriteQuery(sql: string): boolean {
  const cleaned = sql
    .replace(/--[^\n]*(\n|$)/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trimStart();
  if (/;[\s\S]*\S/.test(cleaned)) return true;
  const first = cleaned.match(/^\(?\s*([a-zA-Z]+)/)?.[1].toUpperCase() ?? "";
  return !["SELECT", "WITH", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "VALUES", "TABLE"].includes(
    first,
  );
}

export class ExtensionManager {
  readonly registry = new ExtensionRegistry();
  readonly commands = new CommandRegistry();
  readonly configuration = new ConfigurationRegistry();
  readonly permissions = new PermissionManager();
  readonly views = new ViewRegistry();
  readonly statusBar = new StatusBarRegistry();
  readonly panels = new PanelRegistry();
  readonly events = new EventBus<ExtensionEvents>();
  readonly changes = new EventBus<{ change: null }>();
  readonly logs: { id: string; level: string; message: string; time: string }[] = [];
  private readonly loader: ExtensionLoader;
  private resources = new Map<string, Map<string, Disposable>>();
  private contributions = new Map<string, Disposable[]>();
  private activating = new Map<string, Promise<void>>();
  private mutation: Promise<unknown> = Promise.resolve();
  private fsGrants = new Map<string, Set<string>>();
  constructor(
    private readonly storage: ExtensionStorage,
    private readonly runtime: ExtensionRuntime,
    private readonly core: CoreServices,
    version: string,
  ) {
    this.loader = new ExtensionLoader(runtime, version);
  }
  listExtensions() {
    return structuredClone(this.registry.list());
  }
  listViews(): ViewSnapshot[] {
    return this.views.list();
  }
  listStatusBar(): StatusBarSnapshot[] {
    return this.statusBar.list();
  }
  listPanels(): PanelSnapshot[] {
    return this.panels.list();
  }
  panelMessageFromWebview(extensionId: string, panelId: string, message: Json) {
    this.panels.incoming.emit(`${extensionId}:${panelId}`, message);
  }
  private changed() {
    this.changes.emit("change", null);
  }
  log(id: string, level: string, message: string) {
    this.logs.push({ id, level, message: message.slice(0, 4096), time: new Date().toISOString() });
    if (this.logs.length > 300) this.logs.shift();
    console.info(`[extension:${id}] ${level}: ${message.slice(0, 4096)}`);
    this.changed();
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action);
    this.mutation = result.catch(() => undefined);
    return result;
  }
  async discover() {
    for (const stored of await this.storage.list()) {
      const extension: ExtensionDescriptor = { ...stored, state: "discovered" };
      const id = extension.archive.manifest.id;
      try {
        this.registry.add(extension);
        this.prepare(extension);
      } catch (error) {
        this.fail(extension, error);
      }
      this.log(id, "info", extension.state);
    }
    this.changed();
  }
  private prepare(extension: ExtensionDescriptor) {
    const id = extension.archive.manifest.id;
    this.loader.validate(extension);
    this.permissions.validate(extension.archive.manifest, extension.grants);
    this.configuration.validate(extension, extension.configuration);
    const resources: Disposable[] = [];
    try {
      resources.push(this.commands.reserve(extension.archive.manifest));
      resources.push(this.configuration.reserve(extension.archive.manifest));
      resources.push(this.views.reserve(extension.archive.manifest));
      resources.push(this.statusBar.reserve(extension.archive.manifest));
      resources.push(this.panels.reserve(extension.archive.manifest));
      this.contributions.set(id, resources);
    } catch (error) {
      for (const resource of resources) resource.dispose();
      throw error;
    }
  }
  installExtension(archive: ExtensionArchive, developmentPath?: string) {
    return this.serial(async () => {
      const validated = validateArchive(archive);
      const extension: ExtensionDescriptor = {
        archive: validated,
        enabled: false,
        grants: [],
        configuration: {},
        developmentPath,
        state: "discovered",
      };
      const id = validated.manifest.id;
      this.registry.add(extension);
      try {
        this.prepare(extension);
        await this.storage.install(validated, developmentPath);
      } catch (error) {
        this.release(id);
        this.registry.remove(id);
        throw error;
      }
      this.log(id, "info", "installed (disabled)");
    });
  }
  enableExtension(id: string, grants: Permission[]) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      this.permissions.validate(extension.archive.manifest, grants);
      this.loader.validate(structuredClone(extension));
      if (!this.contributions.has(id)) this.prepare(extension);
      await this.stop(id);
      await this.storage.update(id, true, grants, extension.configuration);
      extension.grants = [...grants];
      extension.enabled = true;
      extension.error = undefined;
      extension.state = "validated";
      this.changed();
      if (
        extension.archive.manifest.activationEvents.includes("onStartup") ||
        (this.core.database() &&
          extension.archive.manifest.activationEvents.includes("onDatabaseOpen"))
      )
        await this.activate(id);
    });
  }
  disableExtension(id: string) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      await this.storage.update(id, false, extension.grants, extension.configuration);
      extension.enabled = false;
      await this.stop(id);
    });
  }
  uninstallExtension(id: string) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      await this.storage.update(id, false, extension.grants, extension.configuration);
      extension.enabled = false;
      await this.stop(id);
      await this.storage.remove(id);
      this.release(id);
      this.registry.remove(id);
      this.fsGrants.delete(id);
      this.changed();
    });
  }
  updateExtension(archive: ExtensionArchive, developmentPath?: string) {
    return this.serial(async () => {
      const validated = validateArchive(archive);
      const id = validated.manifest.id;
      const extension = this.registry.get(id);
      const previous = extension.archive.manifest.version;
      if (!gt(validated.manifest.version, previous))
        throw new ExtensionError(
          "ManifestValidationError",
          `Version ${validated.manifest.version} is not newer than ${previous}`,
        );
      const wasEnabled = extension.enabled;
      await this.stop(id);
      this.release(id);
      const declared = validated.manifest.permissions ?? [];
      const settings = validated.manifest.contributes?.configuration ?? {};
      const restore = structuredClone(extension);
      extension.archive = validated;
      extension.developmentPath = developmentPath;
      extension.grants = extension.grants.filter((grant) => declared.includes(grant));
      extension.configuration = Object.fromEntries(
        Object.entries(extension.configuration).filter(([key]) => Object.hasOwn(settings, key)),
      );
      extension.state = wasEnabled ? "validated" : "discovered";
      extension.error = undefined;
      try {
        this.prepare(extension);
        await this.storage.replace(id, validated, developmentPath);
      } catch (error) {
        this.release(id);
        Object.assign(extension, restore);
        this.prepare(extension);
        throw error;
      }
      this.log(id, "info", `updated ${previous} -> ${validated.manifest.version}`);
      this.changed();
      if (
        wasEnabled &&
        (validated.manifest.activationEvents.includes("onStartup") ||
          (this.core.database() && validated.manifest.activationEvents.includes("onDatabaseOpen")))
      )
        await this.activate(id);
    });
  }
  reloadExtension(id: string, archive?: ExtensionArchive) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      if (archive) {
        const validated = validateArchive(archive);
        if (validated.manifest.id !== id)
          throw new ExtensionError(
            "ManifestValidationError",
            "Development reload cannot change ID",
          );
        if (JSON.stringify(validated.manifest) !== JSON.stringify(extension.archive.manifest))
          throw new ExtensionError(
            "ManifestValidationError",
            "Manifest changed: reinstall to review permissions and contributions",
          );
        extension.archive = validated;
      }
      await this.stop(id);
      if (extension.enabled) await this.activate(id);
    });
  }
  setConfiguration(id: string, values: Record<string, Json>) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      this.configuration.validate(extension, values);
      await this.storage.update(id, extension.enabled, extension.grants, values);
      extension.configuration = structuredClone(values);
      this.changed();
      if (extension.state === "activated")
        this.runtime.event(id, "configurationChanged", { keys: Object.keys(values) });
    });
  }
  revealView(viewId: string) {
    const owner = this.views.owner(viewId);
    if (!owner) throw new ExtensionError("ViewNotFoundError", viewId);
    const event = `onView:${viewId}`;
    return Promise.allSettled(
      this.registry
        .list()
        .filter((e) => e.enabled && e.archive.manifest.activationEvents.includes(event as never))
        .map((e) => this.activate(e.archive.manifest.id)),
    ).then(() => undefined);
  }
  async trigger(event: "onStartup" | "onDatabaseOpen" | `onView:${string}`) {
    await Promise.allSettled(
      this.registry
        .list()
        .filter((e) => e.enabled && e.archive.manifest.activationEvents.includes(event as never))
        .map((e) => this.activate(e.archive.manifest.id)),
    );
  }
  activate(id: string, chain: string[] = []): Promise<void> {
    if (chain.includes(id))
      return Promise.reject(
        new ExtensionError(
          "ExtensionActivationError",
          `Dependency cycle: ${[...chain, id].join(" -> ")}`,
        ),
      );
    const extension = this.registry.get(id);
    if (!extension.enabled) return Promise.reject(new ExtensionError("ExtensionDisabledError", id));
    if (extension.state === "activated") return Promise.resolve();
    const existing = this.activating.get(id);
    if (existing) return existing;
    const operation = this.start(extension, [...chain, id]).finally(() => {
      this.activating.delete(id);
    });
    this.activating.set(id, operation);
    return operation;
  }
  private checkDependencies(id: string, chain: string[] = []) {
    if (chain.includes(id))
      throw new ExtensionError(
        "ExtensionActivationError",
        `Dependency cycle: ${[...chain, id].join(" -> ")}`,
      );
    for (const [dependency, range] of Object.entries(
      this.registry.get(id).archive.manifest.dependencies ?? {},
    )) {
      const descriptor = this.registry.get(dependency);
      if (!descriptor.enabled || !satisfies(descriptor.archive.manifest.version, range))
        throw new ExtensionError(
          "IncompatibleExtensionError",
          `${id} requires enabled ${dependency}@${range}`,
        );
      this.checkDependencies(dependency, [...chain, id]);
    }
  }
  private async start(extension: ExtensionDescriptor, chain: string[]) {
    const id = extension.archive.manifest.id;
    try {
      this.checkDependencies(id);
      if (!this.contributions.has(id)) this.prepare(extension);
      for (const dependency of Object.keys(extension.archive.manifest.dependencies ?? {}))
        await this.activate(dependency, chain);
      const lease = new Map<string, Disposable>();
      this.resources.set(id, lease);
      await this.loader.load(
        extension,
        (method, args) => {
          if (this.resources.get(id) !== lease)
            return Promise.reject(
              new ExtensionError("ExtensionDisabledError", "Expired runtime session"),
            );
          return this.rpc(extension, method, args);
        },
        (error) => {
          if (this.resources.get(id) === lease) this.fail(extension, error);
        },
      );
      await this.runtime.activate(id);
      if (!extension.enabled || extension.state === "failed")
        throw new ExtensionError("ExtensionActivationError", `${id} stopped during activation`);
      extension.state = "activated";
      this.log(id, "info", "activated");
    } catch (error) {
      this.fail(extension, error);
      throw error;
    }
  }
  async executeCommand(id: string, payload?: Json) {
    const owner = this.commands.owner(id);
    if (!owner) throw new ExtensionError("CommandNotFoundError", id);
    await this.activate(owner);
    try {
      return await this.commands.execute(id, payload);
    } catch (error) {
      this.log(owner, "error", String(error));
      throw error;
    }
  }
  private cleanup(id: string) {
    for (const resource of this.resources.get(id)?.values() ?? []) {
      try {
        resource.dispose();
      } catch (error) {
        this.log(id, "error", String(error));
      }
    }
    this.resources.delete(id);
    this.commands.clear(id);
    this.views.clear(id);
    this.statusBar.clear(id);
    this.panels.clear(id);
    this.changed();
  }
  private fail(extension: ExtensionDescriptor, error: unknown) {
    const id = extension.archive.manifest.id;
    extension.state = "failed";
    extension.error = String(error);
    this.cleanup(id);
    void this.runtime.unload(id).catch((e) => this.log(id, "error", String(e)));
    this.log(id, "error", String(error));
  }
  private async stop(id: string) {
    for (const dependent of this.registry.list()) {
      if (
        dependent.state === "activated" &&
        Object.hasOwn(dependent.archive.manifest.dependencies ?? {}, id)
      )
        await this.stop(dependent.archive.manifest.id);
    }
    await this.activating.get(id)?.catch(() => undefined);
    const extension = this.registry.get(id);
    try {
      if (extension.state === "activated") await this.runtime.deactivate(id);
    } catch (error) {
      this.log(id, "error", String(error));
    } finally {
      this.cleanup(id);
      await this.runtime.unload(id);
      extension.state = "deactivated";
      this.changed();
    }
  }
  private release(id: string) {
    for (const resource of this.contributions.get(id) ?? []) resource.dispose();
    this.contributions.delete(id);
  }
  private allowFs(id: string, path: string) {
    let grants = this.fsGrants.get(id);
    if (!grants) {
      grants = new Set();
      this.fsGrants.set(id, grants);
    }
    grants.add(path);
  }
  private requireFs(id: string, path: string) {
    if (!this.fsGrants.get(id)?.has(path))
      throw new ExtensionError("PermissionDeniedError", "Path requires a file dialog grant");
  }
  private async rpc(
    extension: ExtensionDescriptor,
    method: string,
    args: Json[],
  ): Promise<Json | void> {
    const id = extension.archive.manifest.id;
    if (
      (!extension.enabled && method !== "logger" && method !== "dispose") ||
      !this.resources.has(id)
    )
      throw new ExtensionError("ExtensionDisabledError", id);
    if (!Array.isArray(args)) throw new ExtensionError("ProtocolError", "Invalid RPC arguments");
    const limit = method === "panels.open" ? 300000 : method === "views.setTree" ? 280000 : 65536;
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
    const resources = this.resources.get(id)!;
    if (method === "commands.register") {
      const command = text(0, 128);
      const resource = this.commands.register(id, command, (payload) =>
        this.runtime.execute(id, command, payload),
      );
      resources.set(`command:${command}`, resource);
      return;
    }
    if (method === "commands.list") {
      return this.commands.list() as unknown as Json;
    }
    if (method === "dispose") {
      const key = text(0, 256);
      resources.get(key)?.dispose();
      resources.delete(key);
      return;
    }
    if (method === "commands.execute") {
      const command = text(0, 128);
      const owner = this.commands.owner(command);
      if (
        owner !== id &&
        !Object.hasOwn(extension.archive.manifest.dependencies ?? {}, owner ?? "")
      )
        throw new ExtensionError(
          "PermissionDeniedError",
          "Cross-extension commands require a declared dependency",
        );
      if (this.registry.get(owner ?? "").state !== "activated")
        throw new ExtensionError(
          "ExtensionActivationError",
          "Commands invoked by extensions require an activated target",
        );
      return this.commands.execute(command, args[1]);
    }
    if (method === "events.on") {
      this.permissions.require(extension, "database:read");
      const event = text(0, 64);
      if (
        event !== "databaseOpened" &&
        event !== "databaseClosed" &&
        event !== "activeDatabaseChanged"
      )
        throw new ExtensionError("ProtocolError", "Unknown event");
      const key = `event:${event}`;
      if (!resources.has(key))
        resources.set(
          key,
          this.events.on(event as keyof ExtensionEvents, (value) =>
            this.runtime.event(id, event, value as unknown as Json),
          ),
        );
      return;
    }
    if (method === "configuration.onDidChange") {
      const key = "config-changed";
      if (!resources.has(key))
        resources.set(key, {
          dispose: () => undefined,
        });
      return;
    }
    if (method === "notifications.show") {
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
        this.core.notify(message);
        return;
      }
      return (await this.core.prompt({
        kind: "message",
        extensionId: id,
        message,
        level: level === "warn" ? "warning" : (level as "info" | "error"),
        actions,
      })) as Json;
    }
    if (method === "assets.readText") {
      const path = text(0, 240);
      if (!safePath(path) || !Object.hasOwn(extension.archive.files, path))
        throw new ExtensionError("AssetNotFoundError", path);
      return extension.archive.files[path];
    }
    if (method === "configuration.get") return this.configuration.get(extension, text(0, 128));
    if (method === "database.active") {
      this.permissions.require(extension, "database:read");
      return structuredClone(this.core.database()) as unknown as Json;
    }
    if (method === "database.query") {
      this.permissions.require(extension, "database:read");
      const sql = text(0, 32768);
      if (!sql.trim()) throw new ExtensionError("ProtocolError", "Empty query");
      const params = args[1] === undefined || args[1] === null ? undefined : args[1];
      if (
        params !== undefined &&
        (!Array.isArray(params) ||
          params.length > 100 ||
          !params.every(
            (p) =>
              typeof p === "string" ||
              p === null ||
              typeof p === "number" ||
              typeof p === "boolean",
          ))
      )
        throw new ExtensionError("ProtocolError", "Invalid query params");
      const write = isWriteQuery(sql);
      if (write) this.permissions.require(extension, "database:write");
      const request: QueryRequest = {
        sql,
        params: params as (string | null)[] | undefined,
        write,
      };
      return (await this.core.query(request)) as unknown as Json;
    }
    if (method === "network.fetch") {
      this.permissions.require(extension, "network");
      const url = text(0, 8192);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new ExtensionError("ProtocolError", "Invalid URL");
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        throw new ExtensionError("ProtocolError", "Only http(s) URLs are allowed");
      const hosts = extension.archive.manifest.capabilities?.network?.hosts ?? [];
      if (!hosts.some((pattern) => matchesHost(parsed.host, pattern)))
        throw new ExtensionError("PermissionDeniedError", `Host not allowed: ${parsed.host}`);
      const raw = (args[1] ?? null) as unknown as FetchOptions | null;
      const options: FetchOptions =
        raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      if (options.method !== undefined && !HTTP_METHODS.includes(options.method.toUpperCase()))
        throw new ExtensionError("ProtocolError", "Invalid fetch method");
      if (
        options.headers !== undefined &&
        (typeof options.headers !== "object" ||
          Array.isArray(options.headers) ||
          Object.entries(options.headers).length > 20 ||
          Object.entries(options.headers).some(
            ([k, v]) =>
              typeof k !== "string" || typeof v !== "string" || k.length > 256 || v.length > 4096,
          ))
      )
        throw new ExtensionError("ProtocolError", "Invalid fetch headers");
      if (
        options.body !== undefined &&
        (typeof options.body !== "string" || options.body.length > 262144)
      )
        throw new ExtensionError("ProtocolError", "Invalid fetch body");
      if (
        options.timeoutMs !== undefined &&
        (typeof options.timeoutMs !== "number" ||
          options.timeoutMs < 1 ||
          options.timeoutMs > 30000)
      )
        throw new ExtensionError("ProtocolError", "Invalid fetch timeout");
      return (await this.core.fetch({ url, options })) as unknown as Json;
    }
    if (method === "secrets.get" || method === "secrets.set" || method === "secrets.delete") {
      this.permissions.require(extension, "filesystem:extension-storage");
      const key = text(0, 80);
      if (!SECRET_KEY_PATTERN.test(key))
        throw new ExtensionError("ProtocolError", "Invalid secret key");
      if (method === "secrets.get") return this.storage.secretGet(id, key);
      if (method === "secrets.delete") {
        await this.storage.secretDelete(id, key);
        return;
      }
      const value = text(1, 16384);
      await this.storage.secretSet(id, key, value);
      return;
    }
    if (method === "clipboard.read") {
      this.permissions.require(extension, "clipboard:read");
      return this.core.clipboardRead();
    }
    if (method === "clipboard.write") {
      this.permissions.require(extension, "clipboard:write");
      await this.core.clipboardWrite(text(0, 262144));
      return;
    }
    if (method === "workspace.showOpenDialog" || method === "workspace.showSaveDialog") {
      this.permissions.require(extension, "filesystem");
      const hint = optionalText(0, 256);
      const path =
        method === "workspace.showOpenDialog"
          ? await this.core.showOpenDialog(hint)
          : await this.core.showSaveDialog(hint);
      if (path) this.allowFs(id, path);
      return path;
    }
    if (method === "workspace.readFile") {
      this.permissions.require(extension, "filesystem");
      const path = text(0, 4096);
      this.requireFs(id, path);
      return this.core.readTextFile(path);
    }
    if (method === "workspace.writeFile") {
      this.permissions.require(extension, "filesystem");
      const path = text(0, 4096);
      this.requireFs(id, path);
      await this.core.writeTextFile(path, text(1, 1048576));
      return;
    }
    if (method === "process.run") {
      this.permissions.require(extension, "process:execute");
      const command = text(0, 64);
      const allowed = extension.archive.manifest.capabilities?.process?.commands ?? [];
      if (!allowed.includes(command))
        throw new ExtensionError("PermissionDeniedError", `Command not allowed: ${command}`);
      const raw = (args[1] ?? null) as unknown as ProcessOptions | null;
      const options: ProcessOptions =
        raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      if (
        options.args !== undefined &&
        (!Array.isArray(options.args) ||
          options.args.length > 50 ||
          !options.args.every((a) => typeof a === "string" && a.length <= 4096))
      )
        throw new ExtensionError("ProtocolError", "Invalid process args");
      if (
        options.cwd !== undefined &&
        (typeof options.cwd !== "string" || options.cwd.length > 4096)
      )
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
        (typeof options.timeoutMs !== "number" ||
          options.timeoutMs < 1 ||
          options.timeoutMs > 120000)
      )
        throw new ExtensionError("ProtocolError", "Invalid process timeout");
      return (await this.core.runProcess({ command, options })) as unknown as Json;
    }
    if (method === "window.showQuickPick") {
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
        rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions)
          ? rawOptions
          : {};
      const picked = await this.core.prompt({
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
    if (method === "window.showInputBox") {
      const rawOptions = (args[0] ?? null) as unknown as InputBoxOptions | null;
      const options: InputBoxOptions =
        rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions)
          ? rawOptions
          : {};
      return (await this.core.prompt({
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
    if (method === "window.showMessage") {
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
      return (await this.core.prompt({
        kind: "message",
        extensionId: id,
        message,
        level: level as "info" | "warning" | "error",
        actions,
      })) as Json;
    }
    if (method === "views.setTree") {
      const viewId = text(0, 128);
      if (this.views.owner(viewId) !== id) throw new ExtensionError("ViewNotFoundError", viewId);
      const items = args[1] as unknown as TreeItem[];
      validateTreeItems(items);
      this.views.setTree(id, viewId, structuredClone(items) as TreeItem[]);
      this.changed();
      return;
    }
    if (method === "views.reveal") {
      const viewId = text(0, 128);
      if (this.views.owner(viewId) !== id) throw new ExtensionError("ViewNotFoundError", viewId);
      await this.trigger(`onView:${viewId}`);
      this.changed();
      return;
    }
    if (method === "statusBar.set") {
      const itemId = text(0, 128);
      if (this.statusBar.owner(itemId) !== id)
        throw new ExtensionError("StatusBarNotFoundError", itemId);
      const raw = args[1] as unknown as StatusBarUpdate;
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new ExtensionError("ProtocolError", "Invalid status bar update");
      if (raw.command) {
        const owner = this.commands.owner(raw.command);
        if (owner !== id) throw new ExtensionError("CommandNotFoundError", raw.command);
      }
      this.statusBar.set(id, itemId, {
        text: String(raw.text ?? ""),
        tooltip: typeof raw.tooltip === "string" ? raw.tooltip.slice(0, 512) : undefined,
        command: typeof raw.command === "string" && raw.command ? raw.command : undefined,
        background:
          raw.background === "info" || raw.background === "warning" || raw.background === "error"
            ? raw.background
            : undefined,
      });
      this.changed();
      return;
    }
    if (method === "statusBar.hide") {
      const itemId = text(0, 128);
      this.statusBar.hide(id, itemId);
      this.changed();
      return;
    }
    if (method === "panels.open") {
      const panelId = text(0, 128);
      const html = args[1] === undefined || args[1] === null ? "" : text(1, 262144);
      this.panels.open(id, panelId, html);
      this.changed();
      return;
    }
    if (method === "panels.close") {
      this.panels.close(id, text(0, 128));
      this.changed();
      return;
    }
    if (method === "panels.postMessage") {
      this.panels.postToWebview(id, text(0, 128), args[1] ?? null);
      return;
    }
    if (method === "panels.onMessage") {
      const panelId = text(0, 128);
      if (this.panels.owner(panelId) !== id)
        throw new ExtensionError("PanelNotFoundError", panelId);
      const key = `webview:${panelId}`;
      if (!resources.has(key))
        resources.set(
          key,
          this.panels.incoming.on(`${id}:${panelId}`, (message) =>
            this.runtime.event(id, `webview:message:${panelId}`, message),
          ),
        );
      return;
    }
    if (method === "storage.get" || method === "storage.set") {
      this.permissions.require(extension, "filesystem:extension-storage");
      const key = text(0);
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key))
        throw new ExtensionError("ProtocolError", "Invalid storage key");
      if (method === "storage.get") return this.storage.get(id, key);
      return this.storage.set(id, key, args[1] ?? null);
    }
    if (method === "logger") {
      const level = text(0);
      if (!["info", "warn", "error"].includes(level))
        throw new ExtensionError("ProtocolError", "Invalid log level");
      this.log(id, level, text(1));
      return;
    }
    throw new ExtensionError("PermissionDeniedError", `API method unavailable: ${method}`);
  }
}
