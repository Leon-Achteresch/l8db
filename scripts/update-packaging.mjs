#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactNames, publicAssetUrl } from "../.github/scripts/release-artifacts.mjs";

const HELP = `update-packaging - patcht Version und sha256 in die Paketmanifeste unter packaging/

Verwendung:
  node scripts/update-packaging.mjs --release <datei|-> [optionen]

Release-JSON besorgen (eines von beiden):
  gh api repos/Leon-Achteresch/l8db/releases/latest > release.json
  gh release view v0.1.3 --repo Leon-Achteresch/l8db --json tagName,publishedAt,assets > release.json

Optionen:
  --release <pfad|->      GitHub-Release-JSON, "-" liest von stdin
  --artifacts <ordner>    Ordner mit heruntergeladenen Artefakten; sha256 wird lokal berechnet
  --checksums <datei>     Datei mit "<sha256>  <dateiname>" Zeilen
  --version <x.y.z>       ueberschreibt die Version aus dem Release-Tag
  --metadata <datei>      verifizierte release-metadata.json mit MSI ProductCode
  --license-file <datei>  lokale LICENSE des Release-Tags
  --root <ordner>         Repository-Verzeichnis
  --dry-run               zeigt nur, was sich aendern wuerde
  --help                  diese Hilfe

sha256-Quellen werden in dieser Reihenfolge benutzt:
  1. Feld "digest" des Assets im Release-JSON (Format "sha256:<hex>")
  2. --checksums
  3. --artifacts (lokal berechnet)
Fehlende Artefakte, Hashes oder MSI-Metadaten brechen vor jeder Dateiaenderung ab.
`;

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--release") args.release = argv[++i];
    else if (arg === "--artifacts") args.artifacts = argv[++i];
    else if (arg === "--checksums") args.checksums = argv[++i];
    else if (arg === "--version") args.version = argv[++i];
    else if (arg === "--metadata") args.metadata = argv[++i];
    else if (arg === "--license-file") args.licenseFile = argv[++i];
    else if (arg === "--root") args.root = argv[++i];
    else throw new Error(`Unbekannte Option: ${arg}`);
  }
  return args;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    throw new Error("Konnte nichts von stdin lesen.");
  }
}

function loadRelease(source) {
  const raw = source === "-" ? readStdin() : readFileSync(source, "utf8");
  const json = JSON.parse(raw);
  const tag = json.tag_name ?? json.tagName ?? "";
  const assets = (json.assets ?? []).map((asset) => ({
    name: asset.name ?? "",
    url: asset.browser_download_url ?? asset.url ?? "",
    digest: typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/, "") : "",
  }));
  const published = json.published_at ?? json.publishedAt ?? "";
  return { tag, assets, published };
}

function loadChecksums(source) {
  const map = new Map();
  if (!source) return map;
  for (const line of readFileSync(source, "utf8").split("\n")) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match) map.set(path.basename(match[2]), match[1].toLowerCase());
  }
  return map;
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function resolveAsset(assets, name, version) {
  const found = assets.filter((asset) => asset.name === name);
  if (found.length !== 1) throw new Error(`Erwartet genau ein Artefakt: ${name}`);
  if (found[0].url !== publicAssetUrl(version, name))
    throw new Error(`Ungueltige Release-URL: ${name}`);
  return found[0];
}

function resolveSha(asset, checksums, artifactsDir) {
  if (!asset) return "";
  if (asset.digest) return asset.digest.toLowerCase();
  const fromFile = checksums.get(asset.name);
  if (fromFile) return fromFile;
  if (artifactsDir) {
    const local = path.join(artifactsDir, asset.name);
    if (existsSync(local)) return hashFile(local);
  }
  return "";
}

async function resolveLicenseSha(version, file) {
  if (file) return hashFile(file);
  const url = `https://raw.githubusercontent.com/Leon-Achteresch/l8db/v${version}/LICENSE`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`LICENSE konnte nicht geladen werden (${response.status}).`);
  return createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex");
}

function patch(file, replacements) {
  if (!existsSync(file)) {
    throw new Error(`Datei fehlt: ${file}`);
  }
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [pattern, value] of replacements) {
    if (value === null || value === undefined || value === "") continue;
    if (!pattern.test(after)) {
      throw new Error(`Kein Treffer fuer ${pattern} in ${file}`);
    }
    after = after.replace(pattern, value);
  }
  return { file, before, after };
}

function report(result, dryRun) {
  if (!result) return false;
  const rel = path.relative(repoRoot, result.file);
  if (result.before === result.after) {
    console.log(`  unveraendert  ${rel}`);
    return false;
  }
  if (dryRun) {
    console.log(`  wuerde aendern ${rel}`);
    const beforeLines = result.before.split("\n");
    const afterLines = result.after.split("\n");
    for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i += 1) {
      if (beforeLines[i] !== afterLines[i]) {
        if (beforeLines[i] !== undefined) console.log(`    - ${beforeLines[i]}`);
        if (afterLines[i] !== undefined) console.log(`    + ${afterLines[i]}`);
      }
    }
    return true;
  }
  writeFileSync(result.file, result.after);
  console.log(`  geschrieben   ${rel}`);
  return true;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
let repoRoot = path.resolve(scriptDir, "..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.release && !args.version)) {
    console.log(HELP);
    return;
  }
  repoRoot = path.resolve(args.root ?? repoRoot);
  const packagingDir = path.join(repoRoot, "packaging");

  const release = args.release ? loadRelease(args.release) : { tag: "", assets: [], published: "" };
  const version = args.version ?? release.tag.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Ungueltige Version: ${version || "<leer>"}`);
  }
  if (release.tag !== `v${version}`)
    throw new Error("Version stimmt nicht mit dem Release-Tag ueberein.");
  const metadata = JSON.parse(readFileSync(args.metadata, "utf8"));
  if (
    metadata.format !== 1 ||
    metadata.version !== version ||
    !/^\{[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}\}$/.test(
      metadata.productCode,
    )
  ) {
    throw new Error("Verifizierte Release-Metadaten mit passendem MSI ProductCode fehlen.");
  }

  const checksums = loadChecksums(args.checksums);
  const names = artifactNames(version);
  const dmg = resolveAsset(release.assets, names.dmg, version);
  const msi = resolveAsset(release.assets, names.msi, version);
  const deb = resolveAsset(release.assets, names.deb, version);

  const dmgSha = resolveSha(dmg, checksums, args.artifacts);
  const msiSha = resolveSha(msi, checksums, args.artifacts);
  const debSha = resolveSha(deb, checksums, args.artifacts);
  const licenseSha = await resolveLicenseSha(version, args.licenseFile);
  if (licenseSha !== metadata.licenseSha256)
    throw new Error("LICENSE stimmt nicht mit dem verifizierten Release ueberein.");
  for (const [asset, sha, label] of [
    [dmg, dmgSha, "dmg"],
    [msi, msiSha, "msi"],
    [deb, debSha, "deb"],
  ]) {
    if (!/^[a-f0-9]{64}$/.test(sha) || /^0{64}$/.test(sha))
      throw new Error(`Kein gueltiger sha256 fuer ${label} (${asset.name}).`);
    if (sha !== metadata.artifacts?.[asset.name])
      throw new Error(`Hash stimmt nicht mit dem verifizierten Release ueberein: ${asset.name}`);
  }

  const releaseDate = (release.published || "").slice(0, 10);
  const msiUrl =
    msi?.url ||
    `https://github.com/Leon-Achteresch/l8db/releases/download/v${version}/l8db_${version}_x64_en-US.msi`;
  const debUrl =
    deb?.url ||
    `https://github.com/Leon-Achteresch/l8db/releases/download/v${version}/l8db_${version}_amd64.deb`;

  console.log(`Version ${version}${release.tag ? ` (Tag ${release.tag})` : ""}`);

  const results = [
    patch(path.join(packagingDir, "homebrew", "l8db.rb"), [
      [/^(\s*version\s+")[^"]+(")/m, `$1${version}$2`],
      [/^(\s*sha256\s+")[a-fA-F0-9]{64}(")/m, dmgSha ? `$1${dmgSha}$2` : ""],
    ]),
    patch(path.join(packagingDir, "winget", "LeonAchteresch.l8db.yaml"), [
      [/^PackageVersion:.*$/m, `PackageVersion: ${version}`],
    ]),
    patch(path.join(packagingDir, "winget", "LeonAchteresch.l8db.installer.yaml"), [
      [/^PackageVersion:.*$/m, `PackageVersion: ${version}`],
      [/^(\s*)InstallerUrl:.*$/m, `$1InstallerUrl: ${msiUrl}`],
      [/^(\s*)InstallerSha256:.*$/m, msiSha ? `$1InstallerSha256: ${msiSha}` : ""],
      [/^(\s*)ProductCode:.*$/m, `$1ProductCode: '${metadata.productCode}'`],
      [/^ReleaseDate:.*$/m, releaseDate ? `ReleaseDate: ${releaseDate}` : ""],
    ]),
    patch(path.join(packagingDir, "winget", "LeonAchteresch.l8db.locale.en-US.yaml"), [
      [/^PackageVersion:.*$/m, `PackageVersion: ${version}`],
      [
        /^ReleaseNotesUrl:.*$/m,
        `ReleaseNotesUrl: https://github.com/Leon-Achteresch/l8db/releases/tag/v${version}`,
      ],
    ]),
    patch(path.join(packagingDir, "aur", "PKGBUILD"), [
      [/^pkgver=.*$/m, `pkgver=${version}`],
      [/^pkgrel=.*$/m, "pkgrel=1"],
      [/^(sha256sums=\(')[a-fA-F0-9]{64}(')/m, debSha ? `$1${debSha}$2` : ""],
      [/(^\s*')[a-fA-F0-9]{64}('(?:\s*)\)\s*$)/m, licenseSha ? `$1${licenseSha}$2` : ""],
    ]),
    patch(path.join(packagingDir, "aur", ".SRCINFO"), [
      [/^(\tpkgver = ).*$/m, `$1${version}`],
      [/^(\tpkgrel = ).*$/m, "$11"],
      [/^(\tprovides = l8db=).*$/m, `$1${version}`],
      [/^(\tnoextract = l8db-bin-).*(\.deb)$/m, `$1${version}$2`],
      [/^\tsource = l8db-bin-.*\.deb::.*$/m, `\tsource = l8db-bin-${version}.deb::${debUrl}`],
      [
        /^\tsource = LICENSE-.*$/m,
        `\tsource = LICENSE-${version}::https://raw.githubusercontent.com/Leon-Achteresch/l8db/v${version}/LICENSE`,
      ],
      [/^(\tsha256sums = )[a-fA-F0-9]{64}$/m, debSha ? `$1${debSha}` : ""],
      [/(\tsha256sums = )[a-fA-F0-9]{64}(?=\n\npkgname)/m, licenseSha ? `$1${licenseSha}` : ""],
    ]),
    patch(path.join(packagingDir, "flatpak", "com.leon.l8db.yml"), [
      [/^(\s*url: ).*\.deb$/m, `$1${debUrl}`],
      [/^(\s*sha256: ')[a-fA-F0-9]{64}(')/m, debSha ? `$1${debSha}$2` : ""],
    ]),
  ];

  let changed = 0;
  for (const result of results) {
    if (report(result, args.dryRun)) changed += 1;
  }

  console.log(
    args.dryRun
      ? `${changed} Datei(en) wuerden geaendert (dry-run, nichts geschrieben).`
      : `${changed} Datei(en) geaendert.`,
  );
  console.log(
    "Versionen, Artefakt-Hashes, LICENSE und MSI ProductCode sind konsistent. Externe Paket-Repositories separat aktualisieren.",
  );
}

try {
  await main();
} catch (error) {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
}
