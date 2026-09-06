import type {
  Disposable,
  ExtensionDescriptor,
  ExtensionManifest,
  Json,
  Permission,
} from "./contracts";
import { ExtensionError } from "./contracts";

export class ExtensionRegistry {
  private entries = new Map<string, ExtensionDescriptor>();
  list() {
    return [...this.entries.values()];
  }
  get(id: string) {
    const extension = this.entries.get(id);
    if (!extension) throw new ExtensionError("ExtensionNotFoundError", id);
    return extension;
  }
  add(extension: ExtensionDescriptor) {
    const id = extension.archive.manifest.id;
    if (this.entries.has(id)) throw new ExtensionError("DuplicateExtensionError", id);
    this.entries.set(id, extension);
  }
  remove(id: string) {
    this.entries.delete(id);
  }
}
export class CommandRegistry {
  private commands = new Map<
    string,
    { owner: string; title: string; handler?: (payload?: Json) => Promise<Json | void> }
  >();
  reserve(manifest: ExtensionManifest): Disposable {
    const entries = manifest.contributes?.commands ?? [];
    for (const command of entries)
      if (this.commands.has(command.id))
        throw new ExtensionError("DuplicateCommandError", command.id);
    for (const command of entries)
      this.commands.set(command.id, { owner: manifest.id, title: command.title });
    return {
      dispose: () => {
        for (const command of entries) this.commands.delete(command.id);
      },
    };
  }
  register(
    owner: string,
    id: string,
    handler: (payload?: Json) => Promise<Json | void>,
  ): Disposable {
    const entry = this.commands.get(id);
    if (!entry || entry.owner !== owner)
      throw new ExtensionError("CommandRegistrationError", `Undeclared command ${id}`);
    if (entry.handler) throw new ExtensionError("DuplicateCommandError", id);
    entry.handler = handler;
    return {
      dispose: () => {
        if (entry.handler === handler) entry.handler = undefined;
      },
    };
  }
  list() {
    return [...this.commands].map(([id, entry]) => ({
      id,
      owner: entry.owner,
      title: entry.title,
    }));
  }
  owner(id: string) {
    return this.commands.get(id)?.owner;
  }
  clear(owner: string) {
    for (const entry of this.commands.values())
      if (entry.owner === owner) entry.handler = undefined;
  }
  async execute(id: string, payload?: Json) {
    const entry = this.commands.get(id);
    if (!entry?.handler) throw new ExtensionError("CommandNotFoundError", id);
    return entry.handler(payload);
  }
}
export class EventBus<T extends object> {
  private listeners = new Map<keyof T, Set<(value: never) => void | Promise<void>>>();
  constructor(private readonly onError: (error: unknown) => void = () => undefined) {}
  on<K extends keyof T>(event: K, listener: (value: T[K]) => void | Promise<void>): Disposable {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener as (value: never) => void);
    return {
      dispose: () => {
        listeners.delete(listener as (value: never) => void);
      },
    };
  }
  emit<K extends keyof T>(event: K, value: T[K]) {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        void Promise.resolve(listener(structuredClone(value) as never)).catch(this.onError);
      } catch (error) {
        this.onError(error);
      }
    }
  }
}
export class ConfigurationRegistry {
  private owners = new Map<string, string>();
  reserve(manifest: ExtensionManifest): Disposable {
    const keys = Object.keys(manifest.contributes?.configuration ?? {});
    for (const key of keys)
      if (this.owners.has(key)) throw new ExtensionError("DuplicateConfigurationError", key);
    for (const key of keys) this.owners.set(key, manifest.id);
    return {
      dispose: () => {
        for (const key of keys) this.owners.delete(key);
      },
    };
  }
  get(extension: ExtensionDescriptor, key: string): Json {
    const property = extension.archive.manifest.contributes?.configuration?.[key];
    if (
      !Object.hasOwn(extension.archive.manifest.contributes?.configuration ?? {}, key) ||
      !property
    )
      throw new ExtensionError("ConfigurationError", `Unknown setting ${key}`);
    return extension.configuration[key] ?? property.default;
  }
  validate(extension: ExtensionDescriptor, values: Record<string, Json>) {
    for (const [key, value] of Object.entries(values)) {
      const property = extension.archive.manifest.contributes?.configuration?.[key];
      if (
        !Object.hasOwn(extension.archive.manifest.contributes?.configuration ?? {}, key) ||
        !property ||
        typeof value !== property.type ||
        (typeof value === "number" && !Number.isFinite(value))
      )
        throw new ExtensionError("ConfigurationError", key);
    }
  }
}
export class PermissionManager {
  readonly supported: Permission[] = ["database:read", "filesystem:extension-storage"];
  validate(manifest: ExtensionManifest, grants: Permission[]) {
    for (const grant of grants)
      if (!this.supported.includes(grant) || !manifest.permissions?.includes(grant))
        throw new ExtensionError(
          "PermissionDeniedError",
          `Unsupported or undeclared permission: ${grant}`,
        );
  }
  require(extension: ExtensionDescriptor, permission: Permission) {
    this.validate(extension.archive.manifest, extension.grants);
    if (!extension.grants.includes(permission))
      throw new ExtensionError(
        "PermissionDeniedError",
        `${extension.archive.manifest.id}: ${permission}`,
      );
  }
}
