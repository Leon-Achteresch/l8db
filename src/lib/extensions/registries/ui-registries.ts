import {
  type Disposable,
  type ExtensionDescriptor,
  ExtensionError,
  type ExtensionManifest,
  type Json,
  type PanelSnapshot,
  type Permission,
  type StatusBarSnapshot,
  type StatusBarUpdate,
} from "@/lib/extensions/contracts";
import { EventBus } from "./configuration-registry";

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
