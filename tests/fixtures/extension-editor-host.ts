import { validateArchive } from "../../packages/extension-api/src/manifest";
import type {
  CoreServices,
  ExtensionArchive,
  ExtensionDescriptor,
  ExtensionRuntime,
  ExtensionStorage,
  InstalledExtension,
  Json,
  Permission,
  RpcHandler,
} from "../../src/lib/extensions/contracts";
import { ExtensionManager } from "../../src/lib/extensions/manager";
import type { EditorSource } from "../../src/lib/extensions/registries";

export function editorArchive(id = "test.logs", permissions: Permission[] = ["editor:read"]) {
  const command = `${id}.toggle`;
  return validateArchive({
    format: 1,
    manifest: {
      id,
      publisher: id.split(".")[0],
      name: "Logs ausblenden",
      version: "1.0.0",
      engines: { l8db: ">=0.1.0 <2.0.0", api: "^1.2.0" },
      main: "dist/extension.js",
      activationEvents: [`onCommand:${command}`],
      permissions,
      contributes: {
        commands: [{ id: command, title: "Logs ausblenden", icon: "eye-off" }],
        menus: [{ command, location: "editor/toolbar" }],
      },
    },
    files: { "dist/extension.js": "exports.activate = () => {}" },
  });
}

class MemoryStorage {
  entries = new Map<string, InstalledExtension>();
  async list() {
    return structuredClone([...this.entries.values()]);
  }
  async install(archive: ExtensionArchive) {
    this.entries.set(archive.manifest.id, {
      archive,
      enabled: false,
      grants: [],
      configuration: {},
    });
  }
  async remove(id: string) {
    this.entries.delete(id);
  }
  async update(
    id: string,
    enabled: boolean,
    grants: Permission[],
    configuration: Record<string, Json>,
  ) {
    Object.assign(this.entries.get(id)!, { enabled, grants, configuration });
  }
}

export class EditorTestRuntime implements ExtensionRuntime {
  rpc = new Map<string, RpcHandler>();
  failures = new Map<string, (error: Error) => void>();
  descriptors = new Map<string, ExtensionDescriptor>();
  events: { id: string; name: string; payload: Json }[] = [];
  executed: { command: string; payload?: Json }[] = [];
  async load(extension: ExtensionDescriptor, rpc: RpcHandler, onFailure: (error: Error) => void) {
    const id = extension.archive.manifest.id;
    this.rpc.set(id, rpc);
    this.failures.set(id, onFailure);
    this.descriptors.set(id, extension);
  }
  async activate(id: string) {
    for (const command of this.descriptors.get(id)!.archive.manifest.contributes?.commands ?? [])
      await this.rpc.get(id)!("commands.register", [command.id]);
  }
  async deactivate() {}
  async unload(id: string) {
    this.rpc.delete(id);
  }
  async execute(_id: string, command: string, payload?: Json) {
    this.executed.push({ command, payload });
    return payload ?? null;
  }
  event(id: string, name: string, payload: Json) {
    this.events.push({ id, name, payload });
  }
}

export function fakeEditor(text: string, kind: EditorSource["kind"] = "query") {
  const watchers = new Set<() => void>();
  const state = { text, hidden: [] as { startLine: number; endLine: number }[], applied: 0 };
  let counted = { text: "", lines: 1 };
  const source: EditorSource = {
    kind,
    connectionKind: "oracle",
    text: () => state.text,
    lineCount: () => {
      if (counted.text !== state.text)
        counted = { text: state.text, lines: state.text.split("\n").length };
      return counted.lines;
    },
    watch: (listener) => {
      watchers.add(listener);
      return { dispose: () => watchers.delete(listener) };
    },
    hide: (ranges) => {
      state.hidden = ranges;
      state.applied += 1;
    },
  };
  return {
    state,
    source,
    watchers,
    type(next: string) {
      state.text = next;
      for (const watcher of [...watchers]) watcher();
    },
  };
}

export async function editorHost(...archives: ExtensionArchive[]) {
  const runtime = new EditorTestRuntime();
  const manager = new ExtensionManager(
    new MemoryStorage() as unknown as ExtensionStorage,
    runtime,
    { database: () => null } as unknown as CoreServices,
    "0.1.0",
  );
  for (const archive of archives) {
    const id = archive.manifest.id;
    await manager.installExtension(archive);
    await manager.enableExtension(id, archive.manifest.permissions ?? []);
    await manager.activate(id);
  }
  const call = (id: string, method: string, ...args: Json[]) => runtime.rpc.get(id)!(method, args);
  return { manager, runtime, call };
}
