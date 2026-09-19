import {
  type Disposable,
  type ExtensionDescriptor,
  ExtensionError,
  type ExtensionManifest,
  type Json,
} from "@/lib/extensions/contracts";

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
        (typeof value === "number" && !Number.isFinite(value)) ||
        (property.enum !== undefined && !property.enum.includes(value as boolean & string & number))
      )
        throw new ExtensionError("ConfigurationError", key);
    }
  }
}
