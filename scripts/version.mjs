import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pkgPath = "package.json";
const cargoPath = "src-tauri/Cargo.toml";
const tauriPath = "src-tauri/tauri.conf.json";
const lockPath = "src-tauri/Cargo.lock";
const lockVersionPattern = /^(\[\[package\]\]\r?\nname = "l8db"\r?\nversion = ")[^"]+(".*)$/m;

function packageVersion() {
  return JSON.parse(read(pkgPath)).version;
}

function cargoVersion() {
  const match = read(cargoPath).match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("version not found in src-tauri/Cargo.toml [package]");
  return match[1];
}

function cargoLockVersion() {
  const match = read(lockPath).match(/^\[\[package\]\]\r?\nname = "l8db"\r?\nversion = "([^"]+)"/m);
  if (!match) throw new Error("l8db version not found in src-tauri/Cargo.lock");
  return match[1];
}

function tauriVersion() {
  return JSON.parse(read(tauriPath)).version;
}

function versions() {
  return {
    [pkgPath]: packageVersion(),
    [cargoPath]: cargoVersion(),
    [lockPath]: cargoLockVersion(),
    [tauriPath]: tauriVersion(),
  };
}

function check() {
  const found = versions();
  const unique = new Set(Object.values(found));
  for (const [file, version] of Object.entries(found)) console.log(`${file}: ${version}`);
  if (unique.size !== 1) {
    console.error(
      "Version mismatch between package.json, Cargo.toml, Cargo.lock and tauri.conf.json",
    );
    process.exit(1);
  }
  console.log("Versions in sync");
}

function checkTag(tag) {
  if (!tag) {
    console.error("Usage: node scripts/version.mjs check-tag <tag>");
    process.exit(1);
  }
  const expected = tag.replace(/^v/, "");
  check();
  const actual = packageVersion();
  if (actual !== expected) {
    console.error(`Tag ${tag} does not match version ${actual} in source files`);
    process.exit(1);
  }
  console.log(`Tag ${tag} matches version ${actual}`);
}

function set(version) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    console.error("Usage: node scripts/version.mjs set <x.y.z[-prerelease]>");
    process.exit(1);
  }
  const locked = read(lockPath);
  if (!lockVersionPattern.test(locked)) throw new Error("l8db version not found in Cargo.lock");
  cargoVersion();
  const pkg = JSON.parse(read(pkgPath));
  const tauri = JSON.parse(read(tauriPath));
  pkg.version = version;
  writeFileSync(new URL(pkgPath, root), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(new URL(lockPath, root), locked.replace(lockVersionPattern, `$1${version}$2`));
  const cargo = read(cargoPath).replace(
    /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );
  writeFileSync(new URL(cargoPath, root), cargo);
  tauri.version = version;
  writeFileSync(new URL(tauriPath, root), `${JSON.stringify(tauri, null, 2)}\n`);
  console.log(`Version set to ${version} in package.json, Cargo.toml, Cargo.lock, tauri.conf.json`);
}

const [command, arg] = process.argv.slice(2);
if (command === "check") check();
else if (command === "check-tag") checkTag(arg);
else if (command === "set") set(arg);
else {
  console.error("Usage: node scripts/version.mjs <check|check-tag <tag>|set <version>>");
  process.exit(1);
}
