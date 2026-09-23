import { createRoot } from "react-dom/client";
import { CommunityExtensionsSection } from "../../src/features/community-extensions/community-extensions-section";
import { ExtensionMarketSection } from "../../src/features/community-extensions/extension-market-section";
import { ExtensionPrompts } from "../../src/features/extensions/extension-prompts";
import { ExplainPlanView } from "../../src/features/query/explain-plan-view";
import type { ExplainNode } from "../../src/lib/db";
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

const installed = new Map<string, InstalledExtension>();
const secrets = new Map<string, string>();
const requests: { url: string; body: string }[] = [];

const storage: ExtensionStorage = {
  list: async () => [...installed.values()],
  install: async (archive: ExtensionArchive) => {
    installed.set(archive.manifest.id, { archive, enabled: false, grants: [], configuration: {} });
  },
  replace: async (id, archive) => {
    const item = installed.get(id);
    if (!item) throw new Error("Extension fehlt");
    item.archive = archive;
  },
  remove: async (id) => {
    installed.delete(id);
  },
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
  get: async () => null,
  set: async () => undefined,
  secretGet: async (id, key) => secrets.get(`${id}:${key}`) ?? null,
  secretSet: async (id, key, value) => {
    secrets.set(`${id}:${key}`, value);
  },
  secretDelete: async (id, key) => {
    secrets.delete(`${id}:${key}`);
  },
};

const core: CoreServices = {
  database: () => null,
  notify: () => undefined,
  query: async () => {
    throw new Error("Nicht verfügbar");
  },
  fetch: async ({ url, options }) => {
    requests.push({ url, body: options.body ?? "" });
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        answers: { bottleneck: { type: "choice", choice: "scan", confidence: 0.82 } },
      }),
    };
  },
  clipboardRead: async () => "",
  clipboardWrite: async () => undefined,
  showOpenDialog: async () => null,
  showSaveDialog: async () => null,
  readTextFile: async () => "",
  writeTextFile: async () => undefined,
  runProcess: async () => ({ status: 0, stdout: "", stderr: "" }),
  prompt: (request) => useExtensionPrompts.getState().request(request),
};

const manager = new ExtensionManager(storage, new SandboxRuntime(), core, "0.6.0");
const plan: ExplainNode = {
  "Node Type": "Seq Scan",
  "Relation Name": "secret_customers",
  Filter: "email = 'private@example.com'",
  "Startup Cost": 0,
  "Total Cost": 200,
  "Plan Rows": 100,
  "Plan Width": 20,
  "Actual Total Time": 43,
  "Actual Rows": 5000,
};

Object.assign(window, { marketState: { installed, secrets, requests, manager } });

createRoot(document.getElementById("root") as HTMLElement).render(
  <ExtensionHostContext.Provider value={manager}>
    <ExtensionMarketSection />
    <CommunityExtensionsSection />
    <ExplainPlanView
      plan={plan}
      analyzed={true}
      sql="SELECT secret FROM customers"
      connectionName="secret_db"
      databaseKind="postgres"
      onClose={() => undefined}
    />
    <ExtensionPrompts />
  </ExtensionHostContext.Provider>,
);
