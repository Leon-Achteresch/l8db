import { satisfies } from "semver";
import type { ExtensionEvents } from "../../../../packages/extension-api/src";
import type {
  CoreServices,
  Disposable,
  ExtensionDescriptor,
  ExtensionRuntime,
  ExtensionStorage,
  Json,
  PanelSnapshot,
  StatusBarSnapshot,
  ViewSnapshot,
} from "../contracts";
import { ExtensionError } from "../contracts";
import { ExtensionLoader } from "../loader";
import {
  CommandRegistry,
  ConfigurationRegistry,
  EventBus,
  ExtensionRegistry,
  PanelRegistry,
  PermissionManager,
  StatusBarRegistry,
  ViewRegistry,
} from "../registries";
import { dispatchRpc } from "./dispatch-rpc";

export class ExtensionManagerBase {
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
  protected readonly loader: ExtensionLoader;
  protected resources = new Map<string, Map<string, Disposable>>();
  protected contributions = new Map<string, Disposable[]>();
  protected activating = new Map<string, Promise<void>>();
  protected mutation: Promise<unknown> = Promise.resolve();
  protected fsGrants = new Map<string, Set<string>>();
  constructor(
    protected readonly storage: ExtensionStorage,
    protected readonly runtime: ExtensionRuntime,
    protected readonly core: CoreServices,
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
  protected changed() {
    this.changes.emit("change", null);
  }
  log(id: string, level: string, message: string) {
    this.logs.push({ id, level, message: message.slice(0, 4096), time: new Date().toISOString() });
    if (this.logs.length > 300) this.logs.shift();
    console.info(`[extension:${id}] ${level}: ${message.slice(0, 4096)}`);
    this.changed();
  }
  protected serial<T>(action: () => Promise<T>): Promise<T> {
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
  protected prepare(extension: ExtensionDescriptor) {
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
  protected checkDependencies(id: string, chain: string[] = []) {
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
  protected async start(extension: ExtensionDescriptor, chain: string[]) {
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
  protected cleanup(id: string) {
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
  protected fail(extension: ExtensionDescriptor, error: unknown) {
    const id = extension.archive.manifest.id;
    extension.state = "failed";
    extension.error = String(error);
    this.cleanup(id);
    void this.runtime.unload(id).catch((e) => this.log(id, "error", String(e)));
    this.log(id, "error", String(error));
  }
  protected async stop(id: string) {
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
  protected release(id: string) {
    for (const resource of this.contributions.get(id) ?? []) resource.dispose();
    this.contributions.delete(id);
  }
  protected allowFs(id: string, path: string) {
    let grants = this.fsGrants.get(id);
    if (!grants) {
      grants = new Set();
      this.fsGrants.set(id, grants);
    }
    grants.add(path);
  }
  protected requireFs(id: string, path: string) {
    if (!this.fsGrants.get(id)?.has(path))
      throw new ExtensionError("PermissionDeniedError", "Path requires a file dialog grant");
  }
  protected rpc(
    extension: ExtensionDescriptor,
    method: string,
    args: Json[],
  ): Promise<Json | void> {
    return dispatchRpc(extension, method, args, this.resources, {
      runtime: this.runtime,
      core: this.core,
      storage: this.storage,
      registry: this.registry,
      commands: this.commands,
      configuration: this.configuration,
      permissions: this.permissions,
      views: this.views,
      statusBar: this.statusBar,
      panels: this.panels,
      events: this.events,
      changed: () => this.changed(),
      trigger: (event) => this.trigger(event),
      log: (logId, level, message) => this.log(logId, level, message),
      allowFs: (fsId, path) => this.allowFs(fsId, path),
      requireFs: (fsId, path) => this.requireFs(fsId, path),
    });
  }
}
