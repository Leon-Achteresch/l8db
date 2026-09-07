import { gt, satisfies } from "semver";
import type { ExtensionEvents } from "../../../packages/extension-api/src";
import { safePath, validateArchive } from "../../../packages/extension-api/src/manifest";
import type {
  CoreServices,
  Disposable,
  ExtensionArchive,
  ExtensionDescriptor,
  ExtensionRuntime,
  ExtensionStorage,
  Json,
  Permission,
} from "./contracts";
import { ExtensionError } from "./contracts";
import { ExtensionLoader } from "./loader";
import {
  CommandRegistry,
  ConfigurationRegistry,
  EventBus,
  ExtensionRegistry,
  PermissionManager,
} from "./registries";

export class ExtensionManager {
  readonly registry = new ExtensionRegistry();
  readonly commands = new CommandRegistry();
  readonly configuration = new ConfigurationRegistry();
  readonly permissions = new PermissionManager();
  readonly events = new EventBus<ExtensionEvents>();
  readonly changes = new EventBus<{ change: null }>();
  readonly logs: { id: string; level: string; message: string; time: string }[] = [];
  private readonly loader: ExtensionLoader;
  private resources = new Map<string, Map<string, Disposable>>();
  private contributions = new Map<string, Disposable[]>();
  private activating = new Map<string, Promise<void>>();
  private mutation: Promise<unknown> = Promise.resolve();
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
    });
  }
  async trigger(event: "onStartup" | "onDatabaseOpen") {
    await Promise.allSettled(
      this.registry
        .list()
        .filter((e) => e.enabled && e.archive.manifest.activationEvents.includes(event))
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
    if (!Array.isArray(args) || JSON.stringify(args).length > 65536)
      throw new ExtensionError("ProtocolError", "Invalid RPC arguments");
    const text = (index: number) => {
      if (typeof args[index] !== "string" || (args[index] as string).length > 4096)
        throw new ExtensionError("ProtocolError", "Expected string");
      return args[index] as string;
    };
    const resources = this.resources.get(id)!;
    if (method === "commands.register") {
      const command = text(0);
      const resource = this.commands.register(id, command, (payload) =>
        this.runtime.execute(id, command, payload),
      );
      resources.set(`command:${command}`, resource);
      return;
    }
    if (method === "dispose") {
      const key = text(0);
      resources.get(key)?.dispose();
      resources.delete(key);
      return;
    }
    if (method === "commands.execute") {
      const command = text(0);
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
      const event = text(0);
      if (event !== "databaseOpened" && event !== "databaseClosed")
        throw new ExtensionError("ProtocolError", "Unknown event");
      const key = `event:${event}`;
      if (!resources.has(key))
        resources.set(
          key,
          this.events.on(event, (value) => this.runtime.event(id, event, value as unknown as Json)),
        );
      return;
    }
    if (method === "notifications.info") {
      this.core.notify(text(0));
      return;
    }
    if (method === "assets.readText") {
      const path = text(0);
      if (!safePath(path) || !Object.hasOwn(extension.archive.files, path))
        throw new ExtensionError("AssetNotFoundError", path);
      return extension.archive.files[path];
    }
    if (method === "configuration.get") return this.configuration.get(extension, text(0));
    if (method === "database.active") {
      this.permissions.require(extension, "database:read");
      return structuredClone(this.core.database()) as unknown as Json;
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
