import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const config = readJson("../src-tauri/tauri.conf.json");
const windows = readJson("../src-tauri/tauri.windows.conf.json");
const capability = readJson("../src-tauri/capabilities/default.json");
const security = config.app.security;
const csp = security.csp;
assert(csp && typeof csp === "object", "Production CSP must be configured");
assert(
  !csp["script-src"].includes("'unsafe-inline'"),
  "Inline scripts must remain hash restricted",
);
assert(!/(?:https?:|\*)/.test(csp["script-src"]), "Remote scripts must remain blocked");
assert.equal(csp["object-src"], "'none'");
assert.equal(csp["base-uri"], "'none'");
assert.equal(csp["form-action"], "'none'");
assert.equal(
  security.freezePrototype,
  false,
  "Signal libraries override inherited prototype methods",
);
assert(!security.dangerousDisableAssetCspModification, "Keep Tauri CSP injection enabled");
assert.deepEqual(security.capabilities, ["default"]);
assert.deepEqual(capability.windows, ["main", "conn-*"]);
assert(!capability.remote, "Native permissions must remain local");
for (const window of [...config.app.windows, ...windows.app.windows]) {
  assert.equal(window.label, "main");
  assert.notEqual(window.devtools, true);
}
assert.equal(windows.bundle.windows.minimumWebview2Version, "111.0.0.0");
assert.equal(config.bundle.createUpdaterArtifacts, true);
assert.equal(config.bundle.macOS.hardenedRuntime, true);
const updater = config.plugins.updater;
assert(updater.endpoints.length > 0);
for (const endpoint of updater.endpoints) assert.equal(new URL(endpoint).protocol, "https:");
assert.match(Buffer.from(updater.pubkey, "base64").toString(), /^untrusted comment:.*\nRW/);
assert(!("active" in updater || "dialog" in updater), "Remove obsolete Tauri v1 updater options");
execFileSync(process.execPath, [fileURLToPath(new URL("version.mjs", import.meta.url)), "check"], {
  stdio: "inherit",
});
console.log("Production configuration checks passed");
