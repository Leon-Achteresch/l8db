import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { artifactNames, verifyExecutable } from "./release-artifacts.mjs";
import { verifySignedFile } from "./release-signatures.mjs";
import { gh, git, REPOSITORY } from "./release-utils.mjs";

assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "Native installation tests require an isolated GitHub-hosted runner",
);
const platform = process.env.RELEASE_PLATFORM;
assert(["macos", "linux", "windows"].includes(platform), "Invalid smoke platform");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const previousTag = process.env.PREVIOUS_TAG || null;
assert(!previousTag || /^v\d+\.\d+\.\d+$/.test(previousTag), "Invalid upgrade baseline");
const key = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).plugins.updater.pubkey;
const current = resolve("release-assets");
const root = mkdtempSync(join(process.env.RUNNER_TEMP, "l8db-install-"));
const previous = join(root, "previous");
mkdirSync(previous);
const currentNames = artifactNames(version);
const previousNames = previousTag ? artifactNames(previousTag.slice(1)) : null;
const kind = { macos: "mac", linux: "appimage", windows: "nsis" }[platform];
const config = join(root, "config");
mkdirSync(config);
const identifier = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).identifier;
const data =
  platform === "windows"
    ? join(process.env.APPDATA, identifier)
    : platform === "macos"
      ? join(process.env.HOME, "Library/Application Support", identifier)
      : join(config, identifier);
mkdirSync(data, { recursive: true });
const marker = join(data, "release-upgrade-sentinel.json");
writeFileSync(marker, '{"preserve":true}\n');
const environment = { ...process.env, XDG_CONFIG_HOME: config, NO_AT_BRIDGE: "1" };
for (const name of [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
])
  delete environment[name];

if (previousTag) {
  const name = previousNames[kind];
  for (const pattern of [
    name,
    `${name}.sig`,
    ...(platform === "macos" ? [previousNames.dmg] : []),
  ]) {
    gh(
      "release",
      "download",
      previousTag,
      "--repo",
      REPOSITORY,
      "--pattern",
      pattern,
      "--dir",
      previous,
    );
  }
  await verifySignedFile(
    join(previous, name),
    readFileSync(join(previous, `${name}.sig`), "utf8").trim(),
    key,
  );
}
await verifySignedFile(
  join(current, currentNames[kind]),
  readFileSync(join(current, `${currentNames[kind]}.sig`), "utf8").trim(),
  key,
);

async function start(binary, expectedVersion) {
  const probe = spawnSync(binary, ["--check"], {
    env: environment,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(
    probe.status,
    2,
    `Installed ${expectedVersion} CLI cannot start: ${probe.stderr ?? probe.error?.message}`,
  );
  assert(
    (probe.stdout ?? "").length + (probe.stderr ?? "").length > 0,
    "Missing native CLI diagnostic",
  );
  const child = spawn(binary, [], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  child.stdout.on("data", (bytes) => logs.push(bytes));
  child.stderr.on("data", (bytes) => logs.push(bytes));
  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
    child.once("error", (error) => resolveExit({ error: error.message }));
  });
  try {
    const result = await Promise.race([
      exited,
      new Promise((resolveWait) => setTimeout(() => resolveWait(null), 10000)),
    ]);
    assert.equal(
      result,
      null,
      `Installed ${expectedVersion} exited during GUI startup: ${JSON.stringify(result)}\n${Buffer.concat(logs).toString()}`,
    );
  } finally {
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 3000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

const BUNDLE_TYPE = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_");

function binaryHash(file) {
  const bytes = readFileSync(file);
  for (
    let index = bytes.indexOf(BUNDLE_TYPE);
    index >= 0;
    index = bytes.indexOf(BUNDLE_TYPE, index + 1)
  )
    bytes.write("UNK", index + BUNDLE_TYPE.length, "latin1");
  return createHash("sha256").update(bytes).digest("hex");
}

if (platform === "macos") {
  const install = join(root, "Applications");
  mkdirSync(install);
  async function installDmg(directory, names, expectedVersion) {
    const mount = join(root, `mount-${expectedVersion}`);
    mkdirSync(mount);
    execFileSync("hdiutil", [
      "attach",
      join(directory, names.dmg),
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
    ]);
    try {
      const app = join(mount, "l8db.app");
      execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
      execFileSync("xcrun", ["stapler", "validate", app]);
      execFileSync("spctl", ["--assess", "--type", "execute", app]);
      rmSync(join(install, "l8db.app"), { recursive: true, force: true });
      execFileSync("ditto", [app, join(install, "l8db.app")]);
    } finally {
      execFileSync("hdiutil", ["detach", mount]);
    }
    const app = join(install, "l8db.app");
    const actual = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", join(app, "Contents/Info.plist")],
      { encoding: "utf8" },
    ).trim();
    assert.equal(actual, expectedVersion, "Installed macOS version mismatch");
    await start(join(app, "Contents/MacOS/l8db"), expectedVersion);
  }
  if (previousTag) await installDmg(previous, previousNames, previousTag.slice(1));
  await installDmg(current, currentNames, version);
  assert.equal(
    binaryHash(join(install, "l8db.app/Contents/MacOS/l8db")),
    JSON.parse(readFileSync(join(current, "build-macos.json"), "utf8")).packagedBinarySha256,
    "DMG does not contain the signed application",
  );
  const extracted = join(root, "updater");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", join(current, currentNames.mac), "-C", extracted]);
  assert.equal(
    binaryHash(join(extracted, "l8db.app/Contents/MacOS/l8db")),
    binaryHash(join(install, "l8db.app/Contents/MacOS/l8db")),
    "DMG and updater contain different applications",
  );
  rmSync(join(install, "l8db.app"), { recursive: true, force: true });
  execFileSync("ditto", [join(extracted, "l8db.app"), join(install, "l8db.app")]);
  await start(join(install, "l8db.app/Contents/MacOS/l8db"), version);
} else if (platform === "linux") {
  const image = join(root, "l8db.AppImage");
  async function installImage(directory, names, expectedVersion) {
    copyFileSync(join(directory, names.appimage), image);
    execFileSync("chmod", ["+x", image]);
    const extracted = join(root, `appimage-${expectedVersion}`);
    mkdirSync(extracted);
    execFileSync(image, ["--appimage-extract"], { cwd: extracted, stdio: "ignore" });
    const binary = join(extracted, "squashfs-root/usr/bin/l8db");
    verifyExecutable(readFileSync(binary), "linux-x86_64");
    await start(join(extracted, "squashfs-root/AppRun"), expectedVersion);
  }
  if (previousTag) await installImage(previous, previousNames, previousTag.slice(1));
  await installImage(current, currentNames, version);
  const deb = join(root, "deb");
  execFileSync("dpkg-deb", ["-x", join(current, currentNames.deb), deb]);
  const controlVersion = execFileSync(
    "dpkg-deb",
    ["-f", join(current, currentNames.deb), "Version"],
    { encoding: "utf8" },
  ).trim();
  assert.equal(controlVersion, version, "Debian package version mismatch");
  assert.equal(
    binaryHash(join(deb, "usr/bin/l8db")),
    JSON.parse(readFileSync("build-linux.json", "utf8")).binarySha256,
    "Debian package does not contain the compiled application",
  );
  await start(join(deb, "usr/bin/l8db"), version);
} else {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      ".github/scripts/release-smoke.ps1",
      "-Root",
      root,
      "-Current",
      current,
      "-Version",
      version,
      ...(previousTag ? ["-Previous", previous, "-PreviousVersion", previousTag.slice(1)] : []),
    ],
    { stdio: "inherit", env: environment },
  );
  const compiled = JSON.parse(readFileSync("build-windows.json", "utf8")).binarySha256;
  assert.equal(
    binaryHash(join(root, "installed", "l8db.exe")),
    compiled,
    "NSIS contains a different application",
  );
  const msi = readdirSync(join(root, "msi"), { recursive: true }).find((file) =>
    String(file).endsWith("l8db.exe"),
  );
  assert(msi, "MSI does not contain l8db.exe");
  assert.equal(
    binaryHash(join(root, "msi", String(msi))),
    compiled,
    "MSI contains a different application",
  );
}
assert(
  existsSync(marker) && readFileSync(marker, "utf8") === '{"preserve":true}\n',
  "Upgrade removed user configuration",
);
writeFileSync(
  join(current, `smoke-${platform}.json`),
  `${JSON.stringify({ format: 1, sourceSha: git("rev-parse", "HEAD"), version, previousTag, passed: true, checks: ["installed-cli", "gui-startup", "compiled-binary-match", ...(previousTag ? ["previous-install", "upgrade"] : [])] }, null, 2)}\n`,
);
console.log(`${platform} native installation and upgrade smoke passed`);
