import type {
  Disposable,
  ExtensionDescriptor,
  ExtensionManifest,
  Json,
  MenuContribution,
  PanelSnapshot,
  Permission,
  StatusBarSnapshot,
  StatusBarUpdate,
  TreeItem,
  ViewSnapshot,
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
export interface CommandEntry {
  id: string;
  owner: string;
  title: string;
  icon?: string;
}
export class CommandRegistry {
  private commands = new Map<
    string,
    {
      owner: string;
      title: string;
      icon?: string;
      handler?: (payload?: Json) => Promise<Json | void>;
    }
  >();
  private menus: (MenuContribution & { owner: string })[] = [];
  reserve(manifest: ExtensionManifest): Disposable {
    const entries = manifest.contributes?.commands ?? [];
    for (const command of entries)
      if (this.commands.has(command.id))
        throw new ExtensionError("DuplicateCommandError", command.id);
    const menus = manifest.contributes?.menus ?? [];
    for (const menu of menus) {
      if (!entries.some((command) => command.id === menu.command))
        throw new ExtensionError(
          "CommandRegistrationError",
          `Unknown menu command ${menu.command}`,
        );
      if (
        (menu.location === "view/title" || menu.location === "view/item") &&
        !(manifest.contributes?.views ?? []).some((view) => view.id === menu.view)
      )
        throw new ExtensionError("CommandRegistrationError", `Unknown menu view ${menu.view}`);
    }
    for (const command of entries)
      this.commands.set(command.id, {
        owner: manifest.id,
        title: command.title,
        icon: command.icon,
      });
    const owned = menus.map((menu) => ({ ...menu, owner: manifest.id }));
    this.menus.push(...owned);
    return {
      dispose: () => {
        for (const command of entries) this.commands.delete(command.id);
        this.menus = this.menus.filter((menu) => menu.owner !== manifest.id);
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
  list(): CommandEntry[] {
    return [...this.commands].map(([id, entry]) => ({
      id,
      owner: entry.owner,
      title: entry.title,
      icon: entry.icon,
    }));
  }
  menusFor(location: MenuContribution["location"], view?: string) {
    return this.menus.filter(
      (menu) => menu.location === location && (menu.view === undefined || menu.view === view),
    );
  }
  paletteCommands() {
    const palette = new Set(
      this.menus.filter((menu) => menu.location === "palette").map((menu) => menu.command),
    );
    const scoped = new Set(
      this.menus.filter((menu) => menu.location !== "palette").map((menu) => menu.command),
    );
    return this.list().filter((command) => palette.has(command.id) || !scoped.has(command.id));
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
        (typeof value === "number" && !Number.isFinite(value)) ||
        (property.enum !== undefined && !property.enum.includes(value as boolean & string & number))
      )
        throw new ExtensionError("ConfigurationError", key);
    }
  }
}
const treeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export class ViewRegistry {
  private views = new Map<
    string,
    { owner: string; title: string; location: "sidebar" | "panel" }
  >();
  private trees = new Map<string, TreeItem[]>();
  reserve(manifest: ExtensionManifest): Disposable {
    const entries = manifest.contributes?.views ?? [];
    for (const view of entries)
      if (this.views.has(view.id)) throw new ExtensionError("DuplicateViewError", view.id);
    for (const view of entries)
      this.views.set(view.id, { owner: manifest.id, title: view.title, location: view.location });
    return {
      dispose: () => {
        for (const view of entries) {
          this.views.delete(view.id);
          this.trees.delete(view.id);
        }
      },
    };
  }
  owner(viewId: string) {
    return this.views.get(viewId)?.owner;
  }
  setTree(owner: string, viewId: string, items: TreeItem[]) {
    if (this.views.get(viewId)?.owner !== owner)
      throw new ExtensionError("ViewNotFoundError", viewId);
    this.trees.set(viewId, items);
  }
  list(): ViewSnapshot[] {
    return [...this.views].map(([viewId, view]) => ({
      extensionId: view.owner,
      viewId,
      title: view.title,
      location: view.location,
      items: structuredClone(this.trees.get(viewId) ?? []),
    }));
  }
  clear(owner: string) {
    for (const [viewId, view] of this.views) if (view.owner === owner) this.trees.delete(viewId);
  }
}
export function validateTreeItems(items: TreeItem[]) {
  let count = 0;
  const visit = (entries: TreeItem[], depth: number, seen: string[]) => {
    if (depth > 8) throw new ExtensionError("ProtocolError", "View tree too deep");
    for (const item of entries) {
      if (++count > 500) throw new ExtensionError("ProtocolError", "View tree too large");
      if (!item || typeof item !== "object")
        throw new ExtensionError("ProtocolError", "Invalid tree item");
      if (typeof item.id !== "string" || !treeIdPattern.test(item.id))
        throw new ExtensionError("ProtocolError", "Invalid tree item id");
      if (typeof item.label !== "string" || item.label.length === 0 || item.label.length > 256)
        throw new ExtensionError("ProtocolError", "Invalid tree item label");
      if (
        item.description !== undefined &&
        (typeof item.description !== "string" || item.description.length > 256)
      )
        throw new ExtensionError("ProtocolError", "Invalid tree item description");
      if (seen.includes(item.id))
        throw new ExtensionError("ProtocolError", "Duplicate tree item id");
      const trail = [...seen, item.id];
      if (item.children !== undefined) {
        if (!Array.isArray(item.children))
          throw new ExtensionError("ProtocolError", "Invalid tree children");
        visit(item.children, depth + 1, trail);
      }
    }
  };
  if (!Array.isArray(items)) throw new ExtensionError("ProtocolError", "Invalid tree items");
  visit(items, 0, []);
}
export class StatusBarRegistry {
  private items = new Map<
    string,
    { owner: string; alignment: "left" | "right"; priority: number; update?: StatusBarUpdate }
  >();
  reserve(manifest: ExtensionManifest): Disposable {
    const entries = manifest.contributes?.statusBar ?? [];
    for (const item of entries)
      if (this.items.has(item.id)) throw new ExtensionError("DuplicateStatusBarError", item.id);
    for (const item of entries)
      this.items.set(item.id, {
        owner: manifest.id,
        alignment: item.alignment ?? "right",
        priority: item.priority ?? 0,
      });
    return {
      dispose: () => {
        for (const item of entries) this.items.delete(item.id);
      },
    };
  }
  owner(itemId: string) {
    return this.items.get(itemId)?.owner;
  }
  set(owner: string, itemId: string, update: StatusBarUpdate) {
    const entry = this.items.get(itemId);
    if (!entry || entry.owner !== owner) throw new ExtensionError("StatusBarNotFoundError", itemId);
    if (typeof update.text !== "string" || update.text.length === 0 || update.text.length > 120)
      throw new ExtensionError("ProtocolError", "Invalid status bar text");
    entry.update = update;
  }
  hide(owner: string, itemId: string) {
    const entry = this.items.get(itemId);
    if (!entry || entry.owner !== owner) throw new ExtensionError("StatusBarNotFoundError", itemId);
    entry.update = undefined;
  }
  list(): StatusBarSnapshot[] {
    return [...this.items]
      .filter(([, item]) => item.update)
      .map(([itemId, item]) => ({
        extensionId: item.owner,
        itemId,
        alignment: item.alignment,
        priority: item.priority,
        update: structuredClone(item.update!),
      }))
      .sort((a, b) => b.priority - a.priority);
  }
  clear(owner: string) {
    for (const item of this.items.values()) if (item.owner === owner) item.update = undefined;
  }
}
export class PanelRegistry {
  private panels = new Map<string, { owner: string; title: string }>();
  private states = new Map<string, PanelSnapshot>();
  readonly incoming = new EventBus<{ [key: string]: Json }>();
  readonly outgoing = new EventBus<{ [key: string]: Json }>();
  private lastOutgoing = new Map<string, Json>();
  reserve(manifest: ExtensionManifest): Disposable {
    const entries = manifest.contributes?.panels ?? [];
    for (const panel of entries)
      if (this.panels.has(panel.id)) throw new ExtensionError("DuplicatePanelError", panel.id);
    for (const panel of entries)
      this.panels.set(panel.id, { owner: manifest.id, title: panel.title });
    return {
      dispose: () => {
        for (const panel of entries) {
          this.panels.delete(panel.id);
          this.states.delete(`${manifest.id}:${panel.id}`);
        }
      },
    };
  }
  owner(panelId: string) {
    return this.panels.get(panelId)?.owner;
  }
  open(owner: string, panelId: string, html: string) {
    const panel = this.panels.get(panelId);
    if (!panel || panel.owner !== owner) throw new ExtensionError("PanelNotFoundError", panelId);
    if (typeof html !== "string" || html.length > 262144)
      throw new ExtensionError("ProtocolError", "Invalid panel html");
    this.states.set(`${owner}:${panelId}`, {
      extensionId: owner,
      panelId,
      title: panel.title,
      html,
      open: true,
      updatedAt: Date.now(),
    });
  }
  close(owner: string, panelId: string) {
    const key = `${owner}:${panelId}`;
    const state = this.states.get(key);
    if (state) state.open = false;
  }
  postToWebview(owner: string, panelId: string, message: Json) {
    if (this.panels.get(panelId)?.owner !== owner)
      throw new ExtensionError("PanelNotFoundError", panelId);
    const key = `${owner}:${panelId}`;
    this.lastOutgoing.set(key, structuredClone(message));
    this.outgoing.emit(key, message);
  }
  lastMessage(owner: string, panelId: string) {
    return structuredClone(this.lastOutgoing.get(`${owner}:${panelId}`) ?? null);
  }
  list(): PanelSnapshot[] {
    return [...this.states.values()]
      .filter((state) => state.open)
      .map((state) => structuredClone(state));
  }
  clear(owner: string) {
    for (const [key, state] of this.states)
      if (state.extensionId === owner) this.states.delete(key);
  }
}
export class PermissionManager {
  readonly supported: Permission[] = [
    "database:read",
    "database:write",
    "network",
    "filesystem:extension-storage",
    "filesystem",
    "clipboard:read",
    "clipboard:write",
    "process:execute",
  ];
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
