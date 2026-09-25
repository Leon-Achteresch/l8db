import { ExtensionManager } from "../../src/lib/extensions/manager";
import { SandboxRuntime } from "../../src/lib/extensions/sandbox-runtime";
import type { ExtensionArchive, ExtensionManifest, InstalledExtension, Json, ProcessOptions, VaultConnection } from "../../src/lib/extensions/contracts";
import vaultCode from "../../extention/password-manager/dist/extension.js?raw";
import vaultManifest from "../../extention/password-manager/l8db-extension.json";

export async function run() {
  const records = new Map<string, InstalledExtension>();
  const notifications: string[] = [];
  const vaultItems = new Map<string, Record<string, unknown>>();
  const savedConnections: VaultConnection[][] = [];
  const localConnection: VaultConnection = { id: "c-1", name: "Prod", kind: "postgres", connectionString: "postgres://app@db/prod", password: "s3cret", profile: { id: "c-1", name: "Prod", kind: "postgres", connectionString: "postgres://app@db/prod" } };
  const manager = new ExtensionManager({
    list: async () => [...records.values()],
    install: async archive => { records.set(archive.manifest.id, { archive, enabled: false, grants: [], configuration: {} }) },
    replace: async (id, archive) => { Object.assign(records.get(id)!, { archive }) },
    update: async (id, enabled, grants, configuration) => { Object.assign(records.get(id)!, { enabled, grants, configuration }) },
    remove: async id => { records.delete(id) },
    get: async () => null,
    set: async () => undefined,
    secretGet: async () => null,
    secretSet: async () => undefined,
    secretDelete: async () => undefined,
  }, new SandboxRuntime(1500), {
    database: () => null,
    notify: message => notifications.push(message),
    query: async () => { throw new Error("unavailable") },
    fetch: async () => { throw new Error("unavailable") },
    clipboardRead: async () => "",
    clipboardWrite: async () => undefined,
    showOpenDialog: async () => null,
    showSaveDialog: async () => null,
    readTextFile: async () => { throw new Error("unavailable") },
    writeTextFile: async () => { throw new Error("unavailable") },
    runProcess: async ({ command, options }: { command: string; options: ProcessOptions }) => {
      const [verb, ...rest] = options.args ?? [];
      if (command !== "bw") throw new Error("unavailable");
      if (verb === "status") return { status: 0, stdout: '{"status":"locked"}', stderr: "" };
      if (verb === "unlock") return { status: 0, stdout: options.env?.L8DB_BW_PASSWORD === "master" ? "SESSION" : "", stderr: "" };
      if (verb === "list") return { status: 0, stdout: JSON.stringify([...vaultItems.values()]), stderr: "" };
      if (verb === "create") { vaultItems.set("i1", { ...JSON.parse(atob(rest[1])), id: "i1" }); return { status: 0, stdout: "{}", stderr: "" } }
      return { status: 0, stdout: "", stderr: "" };
    },
    prompt: (async (request: { kind: string; items?: { picked?: boolean }[] }) => request.kind === "quickPick" ? request.items!.map((_, index) => index) : request.kind === "inputBox" ? "master" : undefined) as never,
    listConnections: async () => [localConnection],
    saveConnections: async (items: VaultConnection[]) => { savedConnections.push(items); return { added: items.length, updated: 0, skipped: [] } },
  }, "0.1.0");
  const archive = (id: string, code: string): ExtensionArchive => ({
    format: 1,
    manifest: { id, publisher: "test", name: id, version: "1.0.0", engines: { l8db: "^0.1.0", api: "^1.0.0" }, main: "extension.js", activationEvents: [`onCommand:${id}.run`], permissions: ["database:read"], contributes: { commands: [{ id: `${id}.run`, title: "Run" }], configuration: { [`${id}.enabled`]: { type: "boolean", default: true } } } },
    files: { "extension.js": code },
  });
  const good = archive("test.good", `exports.activate = (context, api) => {
    context.subscriptions.push(api.commands.registerCommand('test.good.run', async () => {
      await api.notifications.showInfo('hello');
      return await api.configuration.get('test.good.enabled');
    }));
    context.subscriptions.push(api.events.onDatabaseOpened(event => api.logger.info(event.name)));
    context.subscriptions.push({dispose: () => api.logger.info('disposed')});
  }; exports.deactivate = () => {};`);
  await manager.installExtension(good);
  await manager.enableExtension("test.good", ["database:read"]);
  const command = await manager.executeCommand("test.good.run");
  manager.events.emit("databaseOpened", { connectionId: "safe-id", name: "event-seen", kind: "postgres" });
  await new Promise(resolve => setTimeout(resolve, 100));
  const eventSeen = manager.logs.some(log => log.message === "event-seen");
  await manager.disableExtension("test.good");
  const disposed = manager.logs.some(log => log.message === "disposed");
  await manager.enableExtension("test.good", ["database:read"]);
  const restarted = await manager.executeCommand("test.good.run");
  const hostile = archive("test.hostile", `exports.activate = (context, api) => {
    api.commands.registerCommand('test.hostile.run', async () => {
      let networkBlocked = false, databaseBlocked = false, storageBlocked = false;
      try { await fetch('http://127.0.0.1:1/should-never-connect'); } catch { networkBlocked = true; }
      try { await api.database.getActive(); } catch { databaseBlocked = true; }
      try { await api.storage.get('secret'); } catch { storageBlocked = true; }
      return {networkBlocked, databaseBlocked, storageBlocked, noWindow: typeof window === 'undefined', noTauri: typeof __TAURI_INTERNALS__ === 'undefined', noProcess: typeof process === 'undefined'};
    });
  };`);
  await manager.installExtension(hostile); await manager.enableExtension("test.hostile", []);
  const security = await manager.executeCommand("test.hostile.run");
  const hanging = archive("test.hanging", "exports.activate = () => { while(true) {} };");
  await manager.installExtension(hanging); await manager.enableExtension("test.hanging", []);
  let timeout = false;
  try { await manager.activate("test.hanging") } catch { timeout = true }
  const isolated = await manager.executeCommand("test.good.run");
  const vaultArchive: ExtensionArchive = { format: 1, manifest: { ...(vaultManifest as unknown as ExtensionManifest), engines: { l8db: "^0.1.0", api: "^1.1.0" } }, files: { "dist/extension.js": vaultCode } };
  await manager.installExtension(vaultArchive);
  await manager.enableExtension("l8db.password-manager", ["process:execute", "connections:read"]);
  await manager.setConfiguration("l8db.password-manager", { "vault.provider": "bitwarden" });
  await manager.executeCommand("vault.export");
  await manager.executeCommand("vault.import");
  const vaultWithoutWrite = savedConnections.length;
  await manager.enableExtension("l8db.password-manager", ["process:execute", "connections:read", "connections:write"]);
  await manager.executeCommand("vault.import");
  const vault = { stored: [...vaultItems.values()].map(item => (item.login as { password: string }).password), withoutWrite: vaultWithoutWrite, loaded: savedConnections[0] as unknown as Json };
  for (const item of manager.listExtensions()) await manager.uninstallExtension(item.archive.manifest.id);
  return { vault, command, eventSeen, disposed, restarted, security, timeout, isolated, notifications, remaining: manager.listExtensions().length, frames: document.querySelectorAll("iframe").length } as Json;
}
