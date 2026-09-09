import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Ungueltige Version: ${version ?? "<leer>"}`);
}
execFileSync(
  process.execPath,
  [fileURLToPath(new URL("../../scripts/version.mjs", import.meta.url)), "set", version],
  { stdio: "inherit" },
);
