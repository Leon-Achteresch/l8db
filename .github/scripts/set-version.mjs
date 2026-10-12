import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-canary\.[1-9]\d*)?$/.test(version)) {
  throw new Error(`Ungueltige Version: ${version ?? "<leer>"}`);
}
const run = (path, ...args) =>
  execFileSync(process.execPath, [fileURLToPath(new URL(path, import.meta.url)), ...args], {
    stdio: "inherit",
  });
run("../../scripts/version.mjs", "set", version);
run("generate-changelog.mjs", "--next", version);
if (version.includes("-canary.")) {
  const root = new URL("../../", import.meta.url);
  const canary = new URL("src-tauri/icons/canary/", root);
  for (const file of readdirSync(canary)) {
    copyFileSync(new URL(file, canary), new URL(`src-tauri/icons/${file}`, root));
  }
  copyFileSync(new URL("icon.png", canary), new URL("public/logo.png", root));
}
