import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriDir = join(root, "src-tauri");
const output = process.argv[2] ?? join(root, "public", "third-party-licenses.txt");
const licenseFile = /^(licen[cs]e|copying|copyright|notice|unlicense)([-._].*)?$/i;

function licenseTexts(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => licenseFile.test(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8").replace(/\r\n?/g, "\n").trim())
    .filter(Boolean);
}

function rustPackages() {
  execFileSync("cargo", ["fetch", "--locked"], { cwd: tauriDir, stdio: "inherit" });
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--locked", "--format-version", "1"], {
      cwd: tauriDir,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const stack = [...metadata.workspace_members];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((kind) => kind.kind === null)) stack.push(dep.pkg);
    }
  }
  return [...seen]
    .filter((id) => !metadata.workspace_members.includes(id))
    .map((id) => packages.get(id))
    .map((pkg) => {
      const dir = dirname(pkg.manifest_path);
      const texts = licenseTexts(dir);
      if (pkg.license_file) {
        const file = join(dir, pkg.license_file);
        if (existsSync(file)) texts.push(readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim());
      }
      return {
        name: pkg.name,
        version: pkg.version,
        ecosystem: "Rust",
        spdx: pkg.license ?? "",
        texts,
      };
    });
}

function resolvePackage(name, from) {
  let dir = from;
  while (true) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return realpathSync(dirname(candidate));
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function npmPackages() {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const result = new Map();
  const stack = Object.keys(manifest.dependencies ?? {}).map((name) => [name, root]);
  while (stack.length > 0) {
    const [name, from] = stack.pop();
    const dir = resolvePackage(name, from);
    if (!dir || result.has(dir)) continue;
    if (
      !dir.split(sep).includes("node_modules") &&
      relative(root, dir) &&
      !relative(root, dir).startsWith("..")
    )
      continue;
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const spdx = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "");
    result.set(dir, {
      name: pkg.name,
      version: pkg.version,
      ecosystem: "npm",
      spdx,
      texts: licenseTexts(dir),
    });
    for (const dep of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    })) {
      stack.push([dep, dir]);
    }
  }
  return [...result.values()];
}

function render(packages) {
  const groups = new Map();
  for (const pkg of packages) {
    const key =
      pkg.texts.length > 0 ? pkg.texts.join("\n\n-----\n\n") : `SPDX:${pkg.spdx || "UNKNOWN"}`;
    const group = groups.get(key) ?? { key, spdx: new Set(), members: [] };
    group.spdx.add(pkg.spdx || "UNKNOWN");
    group.members.push(`${pkg.name} ${pkg.version} (${pkg.ecosystem})`);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort(
    (a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key),
  );
  const header = [
    "l8db – Third-party software notices",
    "",
    "l8db is licensed under the Apache License 2.0. This build contains the third-party",
    `components listed below (${packages.length} packages). Components that ship identical`,
    "license texts are grouped together.",
    "",
    "unixODBC: on macOS and Linux, l8db statically links the unixODBC driver manager, which is",
    "licensed under the GNU Lesser General Public License 2.1 or later. Its source code is",
    "available at https://www.unixodbc.org/. The complete source code of l8db is published at",
    "https://github.com/Leon-Achteresch/l8db, so you may rebuild and relink l8db with a modified",
    "version of unixODBC.",
    "",
    "elkjs is used under the Eclipse Public License 2.0; its source code is available at",
    "https://github.com/kieler/elkjs.",
  ].join("\n");
  const body = sorted.map((group) => {
    const license = [...group.spdx].sort().join(", ");
    const text = group.key.startsWith("SPDX:")
      ? `No license file is shipped with these packages. They are distributed under: ${license}`
      : group.key;
    return [`${"=".repeat(80)}`, `License: ${license}`, "", ...group.members.sort(), "", text].join(
      "\n",
    );
  });
  return `${header}\n\n${body.join("\n\n")}\n`;
}

const packages = [...rustPackages(), ...npmPackages()];
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, render(packages));
console.log(`Wrote ${packages.length} third-party packages to ${relative(root, output)}`);
