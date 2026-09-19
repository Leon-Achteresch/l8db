import {
  type Disposable,
  type ExtensionDescriptor,
  ExtensionError,
  type ExtensionManifest,
  type Json,
  type MenuContribution,
} from "@/lib/extensions/contracts";

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
