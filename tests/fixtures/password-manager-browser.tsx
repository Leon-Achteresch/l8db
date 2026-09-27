import { createRoot } from "react-dom/client";
import type { VaultConnection } from "../../packages/extension-api/src";
import { CommunityExtensionsSection } from "../../src/features/community-extensions/community-extensions-section";
import { ExtensionPrompts } from "../../src/features/extensions/extension-prompts";
import type {
  CoreServices,
  ExtensionArchive,
  ExtensionStorage,
  InstalledExtension,
  Json,
  Permission,
} from "../../src/lib/extensions/contracts";
import { ExtensionManager } from "../../src/lib/extensions/manager";
import { useExtensionPrompts } from "../../src/lib/extensions/prompts";
import { ExtensionHostContext } from "../../src/lib/extensions/react-context";
import { SandboxRuntime } from "../../src/lib/extensions/sandbox-runtime";

const archive = (window as unknown as { pmArchive: ExtensionArchive }).pmArchive;
const installed = new Map<string, InstalledExtension>([
  [archive.manifest.id, { archive, enabled: false, grants: [], configuration: {} }],
]);
const data = new Map<string, Json>();
const connections: VaultConnection[] = [
  {
    id: "staging",
    name: "Staging",
    kind: "mysql",
    connectionString: "mysql://app@staging.firma.local:3306/shop",
    password: "staging-pw",
    profile: {
      id: "staging",
      name: "Staging",
      kind: "mysql",
      connectionString: "mysql://app@staging.firma.local:3306/shop",
    },
  },
];
const vault: Record<string, unknown>[] = [
  {
    id: "handmade",
    type: 1,
    name: "l8db: Buchhaltung",
    organizationId: "org-1",
    collectionIds: ["col-1"],
    notes: null,
    login: {
      username: "buchhaltung",
      password: "geheim",
      uris: [{ match: null, uri: "postgres://db.firma.local:5432/finanzen" }],
    },
  },
];
let state = "unauthenticated";

const storage: ExtensionStorage = {
  list: async () => [...installed.values()],
  install: async () => undefined,
  replace: async () => undefined,
  remove: async () => undefined,
  update: async (
    id,
    enabled: boolean,
    grants: Permission[],
    configuration: Record<string, Json>,
  ) => {
    const item = installed.get(id);
    if (!item) throw new Error("Extension fehlt");
    Object.assign(item, { enabled, grants, configuration });
  },
  get: async (_id, key) => data.get(key) ?? null,
  set: async (_id, key, value) => {
    data.set(key, value);
  },
  secretGet: async () => null,
  secretSet: async () => undefined,
  secretDelete: async () => undefined,
};

function decode(value: string) {
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))),
  ) as Record<string, unknown>;
}

function bw(args: string[]) {
  const ok = (value: unknown) => ({
    status: 0,
    stdout: typeof value === "string" ? value : JSON.stringify(value),
    stderr: "",
  });
  const [command, object] = args;
  if (command === "--version") return ok("2026.9.0");
  if (command === "status")
    return ok({
      status: state,
      userEmail: state === "unauthenticated" ? null : "admin@firma.de",
      serverUrl: "https://vault.bitwarden.eu",
    });
  if (command === "config") return ok("Saved setting `config`.");
  if (command === "login") {
    state = "unlocked";
    return ok("SESSION");
  }
  if (command === "sync") return ok("Syncing complete.");
  if (command === "list" && object === "organizations") return ok([{ id: "org-1", name: "Firma" }]);
  if (command === "list" && object === "collections")
    return ok([{ id: "col-1", organizationId: "org-1", name: "Datenbanken" }]);
  if (command === "list") return ok(vault);
  if (command === "create") {
    vault.push({ ...decode(args[2]), id: `item-${vault.length}` });
    return ok("{}");
  }
  if (command === "edit") {
    const index = vault.findIndex((item) => item.id === args[2]);
    vault[index] = { ...decode(args[3]), id: args[2] };
    return ok("{}");
  }
  return { status: 1, stdout: "", stderr: `unknown ${command}` };
}

const core: CoreServices = {
  database: () => null,
  notify: () => undefined,
  query: async () => {
    throw new Error("Nicht verfügbar");
  },
  fetch: async () => {
    throw new Error("Nicht verfügbar");
  },
  clipboardRead: async () => "",
  clipboardWrite: async () => undefined,
  showOpenDialog: async () => null,
  showSaveDialog: async () => null,
  readTextFile: async () => "",
  writeTextFile: async () => undefined,
  runProcess: async ({ command, options }) => {
    if (command !== "bw") throw new Error("No such file or directory");
    return bw(options.args ?? []);
  },
  prompt: (request) => useExtensionPrompts.getState().request(request),
  listConnections: async () => connections,
  saveConnections: async (items) => {
    let added = 0;
    for (const item of items) {
      const index = connections.findIndex((entry) => entry.id === item.id);
      if (index < 0) {
        connections.push(item);
        added++;
      } else connections[index] = item;
    }
    return { added, updated: items.length - added, skipped: [] };
  },
  removeConnections: async (ids) => {
    const before = connections.length;
    for (const id of ids) {
      const index = connections.findIndex((entry) => entry.id === id);
      if (index >= 0) connections.splice(index, 1);
    }
    return before - connections.length;
  },
};

const manager = new ExtensionManager(storage, new SandboxRuntime(), core, "0.7.0");

Object.assign(window, { pmState: { vault, connections, data, manager } });
await manager.discover();

createRoot(document.getElementById("root") as HTMLElement).render(
  <ExtensionHostContext.Provider value={manager}>
    <div className="@container mx-auto max-w-3xl p-6">
      <CommunityExtensionsSection />
    </div>
    <ExtensionPrompts />
  </ExtensionHostContext.Provider>,
);
