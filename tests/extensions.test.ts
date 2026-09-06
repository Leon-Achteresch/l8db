import { describe, expect, test } from "bun:test";
import { ExtensionManager } from "../src/lib/extensions/manager";
import { CommandRegistry, EventBus } from "../src/lib/extensions/registries";
import { ExtensionError, assertCompatible, validateArchive, validateManifest } from "../packages/extension-api/src/manifest";
import type { ExtensionArchive, ExtensionDescriptor, ExtensionRuntime, ExtensionStorage, InstalledExtension, Json, Permission, RpcHandler } from "../src/lib/extensions/contracts";

function archive(id = "test.example", events: string[] = ["onCommand:test.hello"]): ExtensionArchive {
  return validateArchive({ format: 1, manifest: { id, publisher: id.split(".")[0], name: "Test", version: "1.0.0", engines: { l8db: ">=0.1.0 <1.0.0" }, main: "dist/extension.js", activationEvents: events, permissions: ["database:read", "filesystem:extension-storage"], contributes: { commands: [{ id: "test.hello", title: "Hello" }], configuration: { "test.enabled": { type: "boolean", default: true } } } }, files: { "dist/extension.js": "exports.activate = () => {}" } });
}
class MemoryStorage implements ExtensionStorage {
  entries = new Map<string, InstalledExtension>();
  values = new Map<string, Json>();
  async list() { return structuredClone([...this.entries.values()]) }
  async install(value: ExtensionArchive) { this.entries.set(value.manifest.id, { archive: value, enabled: false, grants: [], configuration: {} }) }
  async remove(id: string) { this.entries.delete(id) }
  async update(id: string, enabled: boolean, grants: Permission[], configuration: Record<string, Json>) { Object.assign(this.entries.get(id)!, { enabled, grants, configuration }) }
  async get(id: string, key: string) { return this.values.get(`${id}:${key}`) ?? null }
  async set(id: string, key: string, value: Json) { this.values.set(`${id}:${key}`, value) }
}
class TestRuntime implements ExtensionRuntime {
  rpc = new Map<string, RpcHandler>();
  descriptors = new Map<string, ExtensionDescriptor>();
  loads: string[] = [];
  activations: string[] = [];
  unloaded: string[] = [];
  deactivated: string[] = [];
  events: string[] = [];
  fail = "";
  async load(extension: ExtensionDescriptor, rpc: RpcHandler) { const id = extension.archive.manifest.id; this.loads.push(id); this.rpc.set(id, rpc); this.descriptors.set(id, extension) }
  async activate(id: string) {
    this.activations.push(id);
    if (id === this.fail) throw new Error("broken extension");
    for (const command of this.descriptors.get(id)!.archive.manifest.contributes?.commands ?? []) await this.rpc.get(id)!("commands.register", [command.id]);
  }
  async deactivate(id: string) { this.deactivated.push(id); await this.rpc.get(id)!("logger", ["info", "deactivated"]) }
  async unload(id: string) { this.unloaded.push(id); this.rpc.delete(id) }
  async execute(id: string, _command: string, payload?: Json) { await this.rpc.get(id)!("notifications.info", ["Hello"]); return payload ?? "ok" }
  event(id: string, name: string) { this.events.push(`${id}:${name}`) }
}
function setup() {
  const storage = new MemoryStorage();
  const runtime = new TestRuntime();
  const notifications: string[] = [];
  const manager = new ExtensionManager(storage, runtime, { database: () => null, notify: message => notifications.push(message) }, "0.1.0");
  return { storage, runtime, manager, notifications };
}
function other(id: string) {
  const value = archive(id, ["onStartup"]);
  value.manifest.contributes = {};
  return value;
}
describe("extension manifest", () => {
  test("normalizes main and API version", () => { const value = archive(); value.manifest.main = "./dist/extension.js"; expect(validateManifest(value.manifest).main).toBe("dist/extension.js"); expect(validateManifest(value.manifest).engines.api).toBe("^1.0.0") });
  test("rejects malformed manifests", () => {
    for (const patch of [{ id: "../escape" }, { version: "yesterday" }, { main: "../outside.js" }, { main: "C:/file.js" }, { main: "dist/NUL.js" }, { permissions: ["root"] }, { activationEvents: ["onCommand:missing"] }, { engines: { l8db: "oops" } }, { dependencies: { "test.example": "*" } }, { contributes: { configuration: { x: { type: "boolean", default: "true" } } } }]) expect(() => validateManifest({ ...archive().manifest, ...patch })).toThrow();
  });
  test("rejects path traversal and absent compiled code", () => {
    const value = archive(); value.files["../bad"] = "bad"; expect(() => validateArchive(value)).toThrow();
    expect(() => validateArchive({ ...archive(), files: {} })).toThrow();
  });
  test("checks semver boundaries and prereleases", () => {
    const manifest = archive().manifest;
    assertCompatible(manifest, "0.1.0");
    assertCompatible(manifest, "0.9.9");
    for (const version of ["1.0.0", "0.0.9", "0.2.0-beta.1"]) expect(() => assertCompatible(manifest, version)).toThrow(ExtensionError);
  });
});
describe("extension lifecycle integration", () => {
  test("install → discover → enable → lazy command → disable → uninstall", async () => {
    const { manager, runtime, storage, notifications } = setup();
    await manager.installExtension(archive());
    expect(manager.listExtensions()[0].state).toBe("validated");
    expect(storage.entries.get("test.example")?.enabled).toBe(false);
    await expect(manager.executeCommand("test.hello")).rejects.toThrow(ExtensionError);
    await manager.enableExtension("test.example", []);
    expect(runtime.activations).toEqual([]);
    expect(await manager.executeCommand("test.hello", { value: 7 })).toEqual({ value: 7 });
    expect(notifications).toEqual(["Hello"]);
    expect(manager.listExtensions()[0].state).toBe("activated");
    await manager.disableExtension("test.example");
    expect(manager.listExtensions()[0].state).toBe("deactivated");
    await expect(manager.commands.execute("test.hello")).rejects.toThrow(ExtensionError);
    await manager.uninstallExtension("test.example");
    expect(manager.commands.list()).toEqual([]);
    expect(await storage.list()).toEqual([]);
  });
  test("discovery validates stored packages and isolates incompatibility", async () => {
    const { manager, storage } = setup();
    await storage.install(archive());
    const bad = other("test.bad"); bad.manifest.engines.l8db = ">=99.0.0"; await storage.install(bad);
    await manager.discover();
    expect(manager.registry.get("test.example").state).toBe("validated");
    expect(manager.registry.get("test.bad").state).toBe("failed");
  });
  test("startup and database activation events activate only enabled matching extensions", async () => {
    const { manager, runtime } = setup();
    await manager.installExtension(other("test.startup"));
    const database = other("test.database"); database.manifest.activationEvents = ["onDatabaseOpen"];
    await manager.installExtension(database);
    await manager.enableExtension("test.startup", []);
    await manager.enableExtension("test.database", []);
    expect(runtime.activations).toEqual(["test.startup"]);
    await manager.trigger("onDatabaseOpen");
    expect(runtime.activations).toEqual(["test.startup", "test.database"]);
  });
  test("concurrent commands activate once", async () => {
    const { manager, runtime } = setup(); await manager.installExtension(archive()); await manager.enableExtension("test.example", []);
    await Promise.all([manager.executeCommand("test.hello"), manager.executeCommand("test.hello")]);
    expect(runtime.activations).toEqual(["test.example"]);
  });
  test("permission checks happen at host boundary and disposal removes event subscriptions", async () => {
    const { manager, runtime } = setup(); await manager.installExtension(archive()); await manager.enableExtension("test.example", []); await manager.activate("test.example");
    const denied = runtime.rpc.get("test.example")!;
    await expect(denied("database.active", [])).rejects.toThrow(ExtensionError);
    await expect(denied("network.fetch", ["https://example.com"])).rejects.toThrow(ExtensionError);
    await expect(denied("storage.get", ["key"])).rejects.toThrow(ExtensionError);
    await expect(manager.enableExtension("test.example", ["network"])).rejects.toThrow(ExtensionError);
    await manager.enableExtension("test.example", ["database:read", "filesystem:extension-storage"]); await manager.activate("test.example");
    const allowed = runtime.rpc.get("test.example")!;
    await allowed("events.on", ["databaseOpened"]);
    manager.events.emit("databaseOpened", { connectionId: "1", name: "db", kind: "postgres" });
    expect(runtime.events).toHaveLength(1);
    await allowed("storage.set", ["key", { value: 1 }]); expect(await allowed("storage.get", ["key"])).toEqual({ value: 1 });
    await expect(allowed("storage.get", ["../other"])).rejects.toThrow();
    await manager.disableExtension("test.example");
    manager.events.emit("databaseOpened", { connectionId: "1", name: "db", kind: "postgres" });
    expect(runtime.events).toHaveLength(1);
    await expect(allowed("storage.get", ["key"])).rejects.toThrow(ExtensionError);
  });
  test("failure isolation and restart", async () => {
    const { manager, runtime } = setup(); await manager.installExtension(archive()); await manager.installExtension(other("test.good"));
    runtime.fail = "test.example";
    await manager.enableExtension("test.example", []);
    await expect(manager.activate("test.example")).rejects.toThrow("broken");
    await manager.enableExtension("test.good", []);
    expect(manager.registry.get("test.good").state).toBe("activated");
    expect(manager.registry.get("test.example").state).toBe("failed");
    runtime.fail = ""; await manager.reloadExtension("test.example");
    expect(await manager.executeCommand("test.hello")).toBe("ok");
  });
  test("duplicate contributions roll back installation", async () => {
    const { manager, storage } = setup(); await manager.installExtension(archive());
    await expect(manager.installExtension(archive("test.duplicate"))).rejects.toThrow(ExtensionError);
    expect(await storage.list()).toHaveLength(1); expect(manager.commands.owner("test.hello")).toBe("test.example");
  });
  test("configuration validates writes and isolates namespaces", async () => {
    const { manager } = setup(); await manager.installExtension(archive());
    expect(manager.configuration.get(manager.registry.get("test.example"), "test.enabled")).toBe(true);
    await manager.setConfiguration("test.example", { "test.enabled": false });
    expect(manager.configuration.get(manager.registry.get("test.example"), "test.enabled")).toBe(false);
    await expect(manager.setConfiguration("test.example", { other: true })).rejects.toThrow();
    await expect(manager.setConfiguration("test.example", { "test.enabled": "wrong" })).rejects.toThrow();
  });
  test("dependencies enforce versions and cycles without hanging", async () => {
    const { manager } = setup(); const a = other("test.a"), b = other("test.b");
    a.manifest.activationEvents = []; b.manifest.activationEvents = [];
    a.manifest.dependencies = { "test.b": "^1.0.0" }; b.manifest.dependencies = { "test.a": "^1.0.0" };
    await manager.installExtension(a); await manager.installExtension(b); await manager.enableExtension("test.a", []);
    await expect(manager.activate("test.a")).rejects.toThrow(ExtensionError);
    await manager.enableExtension("test.b", []);
    await expect(manager.activate("test.a")).rejects.toThrow("cycle");
  });
});
test("command registry rejects duplicate handlers and disposes idempotently", async () => {
  const commands = new CommandRegistry(); const reservation = commands.reserve(archive().manifest);
  const disposable = commands.register("test.example", "test.hello", async () => 42);
  expect(() => commands.register("test.example", "test.hello", async () => 43)).toThrow(ExtensionError);
  expect(await commands.execute("test.hello")).toBe(42); disposable.dispose(); disposable.dispose();
  await expect(commands.execute("test.hello")).rejects.toThrow(); reservation.dispose(); expect(commands.list()).toEqual([]);
});
test("event bus isolates listener failures and snapshots payloads", async () => {
  const errors: unknown[] = []; const bus = new EventBus<{ event: { value: number } }>(error => errors.push(error)); const seen: number[] = [];
  bus.on("event", event => { event.value = 99; throw new Error("bad listener") });
  const listener = bus.on("event", event => { seen.push(event.value) });
  bus.emit("event", { value: 1 }); listener.dispose(); bus.emit("event", { value: 2 });
  expect(seen).toEqual([1]); expect(errors).toHaveLength(2);
});

test("grant changes deactivate resources and invalidate old runtime sessions", async () => {
  const { manager, runtime } = setup();
  await manager.installExtension(archive()); await manager.enableExtension("test.example", ["database:read"]); await manager.activate("test.example");
  const old = runtime.rpc.get("test.example")!;
  await manager.enableExtension("test.example", []); await manager.activate("test.example");
  expect(runtime.deactivated).toEqual(["test.example"]);
  await expect(old("notifications.info", ["stale"])).rejects.toThrow("Expired runtime session");
});
test("disabling a dependency stops its active dependents", async () => {
  const { manager, runtime } = setup(); const dependency = other("test.dependency"), dependent = other("test.dependent");
  dependent.manifest.dependencies = { "test.dependency": "^1.0.0" };
  await manager.installExtension(dependency); await manager.installExtension(dependent);
  await manager.enableExtension("test.dependency", []); await manager.enableExtension("test.dependent", []);
  await manager.disableExtension("test.dependency");
  expect(runtime.deactivated).toEqual(["test.dependent", "test.dependency"]);
  await expect(manager.activate("test.dependent")).rejects.toThrow("requires enabled");
});
test("a new manager discovers persisted enablement and activates on startup", async () => {
  const { manager, storage } = setup(); await manager.installExtension(other("test.persisted")); await manager.enableExtension("test.persisted", []);
  const runtime = new TestRuntime(); const restored = new ExtensionManager(storage, runtime, { database: () => null, notify: () => undefined }, "0.1.0");
  await restored.discover(); await restored.trigger("onStartup");
  expect(restored.registry.get("test.persisted").state).toBe("activated");
});
