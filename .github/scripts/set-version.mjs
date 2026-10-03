import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Ungueltige Version: ${version ?? "<leer>"}`);
}
const run = (path, ...args) =>
  execFileSync(process.execPath, [fileURLToPath(new URL(path, import.meta.url)), ...args], {
    stdio: "inherit",
  });
run("../../scripts/version.mjs", "set", version);
run("generate-changelog.mjs", "--next", version);
