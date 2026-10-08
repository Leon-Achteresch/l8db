import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateManifest, verifyArtifacts } from "./release-artifacts.mjs";
import {
  api,
  CANARY_PATTERN,
  compareVersions,
  gh,
  git,
  newestRelease,
  outputs,
  REPOSITORY,
  releases,
  VERSION_PATTERN,
} from "./release-utils.mjs";

export function releaseNotes(version, changelog) {
  const heading = new RegExp(
    `^## \\[${version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    "m",
  );
  const match = heading.exec(changelog);
  assert(match, `Missing release notes for ${version}`);
  return changelog
    .slice(match.index)
    .split(/\n(?=## )/, 1)[0]
    .trim();
}

function currentVersion() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  assert(VERSION_PATTERN.test(version) || CANARY_PATTERN.test(version), "Invalid release version");
  return version;
}

function channel(version) {
  return CANARY_PATTERN.test(version) ? "canary" : "stable";
}

function assertDraft(release, version, sha) {
  assert.equal(release.tag_name, `v${version}`, "Release tag mismatch");
  assert.equal(release.target_commitish, sha, "Release source commit mismatch");
  assert(
    release.draft && !release.immutable && release.prerelease === CANARY_PATTERN.test(version),
    `Release must be an editable ${channel(version)} draft`,
  );
}

function draft() {
  const version = currentVersion();
  const sha = git("rev-parse", "HEAD");
  let release = releases(channel(version)).find((item) => item.tag_name === `v${version}`);
  if (release?.draft && release.target_commitish !== sha) {
    gh("api", "-X", "DELETE", `repos/${REPOSITORY}/releases/${release.id}`);
    release = undefined;
  }
  if (!release) {
    const file = join(process.env.RUNNER_TEMP, "release-notes.md");
    writeFileSync(file, releaseNotes(version, readFileSync("CHANGELOG.md", "utf8")));
    release = JSON.parse(
      gh(
        "api",
        `repos/${REPOSITORY}/releases`,
        "-f",
        `tag_name=v${version}`,
        "-f",
        `target_commitish=${sha}`,
        "-f",
        `name=l8db v${version}`,
        "-F",
        `body=@${file}`,
        "-F",
        "draft=true",
        "-F",
        `prerelease=${CANARY_PATTERN.test(version)}`,
      ),
    );
  }
  assert(release, "Draft release was not created");
  assertDraft(release, version, sha);
  outputs({ release_id: release.id });
  console.log(`Draft v${version} belongs to ${sha}`);
}

async function publish() {
  const version = currentVersion();
  const sha = git("rev-parse", "HEAD");
  const canary = CANARY_PATTERN.test(version);
  const all = releases(channel(version));
  const release = all.find((item) => item.tag_name === `v${version}`);
  if (release && !release.draft) {
    assert.equal(release.target_commitish, sha, "Published release belongs to another commit");
    console.log(`v${version} is already published; keeping immutable assets`);
    return;
  }
  assert(release, "Missing draft release");
  assertDraft(release, version, sha);
  const latest = canary ? undefined : newestRelease(all);
  assert(
    !latest || compareVersions(version, latest.tag_name.slice(1)) > 0,
    "Refusing to replace latest with an older release",
  );
  const directory = resolve(process.env.RUNNER_TEMP, "verified-release");
  mkdirSync(directory, { recursive: true });
  gh("release", "download", `v${version}`, "--repo", REPOSITORY, "--dir", directory, "--clobber");
  const assets = api(`repos/${REPOSITORY}/releases/${release.id}/assets?per_page=100`);
  for (const platform of ["macos", "linux", "windows"]) {
    const metadata = JSON.parse(readFileSync(join(directory, `build-${platform}.json`), "utf8"));
    assert.equal(metadata.sourceSha, sha, `Wrong ${platform} build commit`);
    assert.equal(metadata.version, version, `Wrong ${platform} build version`);
    const smoke = JSON.parse(readFileSync(join(directory, `smoke-${platform}.json`), "utf8"));
    assert.equal(smoke.sourceSha, sha, `Wrong ${platform} smoke commit`);
    assert.equal(smoke.version, version, `Wrong ${platform} smoke version`);
    assert.equal(
      smoke.previousTag,
      process.env.PREVIOUS_TAG || null,
      `Wrong ${platform} upgrade baseline`,
    );
    assert.equal(smoke.passed, true, `Failed ${platform} installation test`);
  }
  const packaging = JSON.parse(readFileSync(join(directory, "packaging-metadata.json"), "utf8"));
  assert.equal(packaging.version, version, "Wrong MSI metadata version");
  assert(
    /^\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}$/.test(
      packaging.productCode,
    ),
    "Missing MSI ProductCode",
  );
  const notes = releaseNotes(version, readFileSync("CHANGELOG.md", "utf8"));
  const manifest = generateManifest(directory, version, notes);
  const manifestPath = join(directory, "latest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const verifiedAssets = assets.filter(
    (asset) => !["latest.json", "SHA256SUMS", "release-metadata.json"].includes(asset.name),
  );
  verifiedAssets.push({ name: "latest.json", size: statSync(manifestPath).size });
  const publicKey = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).plugins.updater
    .pubkey;
  const hashes = await verifyArtifacts(manifest, verifiedAssets, version, directory, publicKey);
  writeFileSync(
    join(directory, "SHA256SUMS"),
    [...hashes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, hash]) => `${hash}  ${name}\n`)
      .join(""),
  );
  writeFileSync(
    join(directory, "release-metadata.json"),
    `${JSON.stringify(
      {
        format: 1,
        version,
        sourceSha: sha,
        previousTag: process.env.PREVIOUS_TAG || null,
        licenseSha256: createHash("sha256").update(readFileSync("LICENSE")).digest("hex"),
        productCode: packaging.productCode,
        artifacts: Object.fromEntries(hashes),
      },
      null,
      2,
    )}\n`,
  );
  gh(
    "release",
    "upload",
    `v${version}`,
    manifestPath,
    join(directory, "SHA256SUMS"),
    join(directory, "release-metadata.json"),
    "--repo",
    REPOSITORY,
    "--clobber",
  );
  assertDraft(api(`repos/${REPOSITORY}/releases/${release.id}`), version, sha);
  gh(
    "release",
    "edit",
    `v${version}`,
    "--repo",
    REPOSITORY,
    "--draft=false",
    canary ? "--latest=false" : "--latest",
  );
  console.log(`Published verified ${channel(version)} release v${version}`);
}

function followup() {
  let tag = process.env.RELEASE_TAG || "";
  if (!tag && process.env.RELEASE_SHA) {
    assert(/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA), "Invalid follow-up source SHA");
    const release = releases().find(
      (item) => !item.draft && item.target_commitish === process.env.RELEASE_SHA,
    );
    tag = release?.tag_name ?? "";
  }
  if (!tag) {
    outputs({ tag: "", packaging: "false" });
    console.log("No published app release for this run");
    return;
  }
  assert(/^v\d+\.\d+\.\d+$/.test(tag), "Invalid follow-up release tag");
  const all = releases();
  const release = all.find((item) => item.tag_name === tag && !item.draft);
  assert(release, "Follow-up requires a published stable release");
  outputs({
    tag,
    version: tag.slice(1),
    packaging: newestRelease(all)?.id === release.id ? "true" : "false",
  });
}

function upload() {
  const version = currentVersion();
  const release = releases(channel(version)).find((item) => item.tag_name === `v${version}`);
  assertDraft(release, version, git("rev-parse", "HEAD"));
  const directory = "release-assets";
  const files = readdirSync(directory).map((name) => join(directory, name));
  assert(files.length > 0, "No packaged artifacts");
  gh("release", "upload", `v${version}`, ...files, "--repo", REPOSITORY, "--clobber");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === "draft") draft();
  else if (command === "publish") await publish();
  else if (command === "followup") followup();
  else if (command === "upload") upload();
  else throw new Error("Usage: release.mjs draft|publish|followup|upload");
}
