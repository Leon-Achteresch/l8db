import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compare, valid } from "semver";
import {
  ASSET_BASE,
  clipTag,
  type FeatureVideo,
  MAX_AGE,
  MEDIA_REPOSITORY,
  MEDIA_TAG,
  parseFeed,
} from "../../src/lib/feature-videos/model";
import { api, clipReleases, gh, mediaRelease, releaseAssets } from "./github";
import {
  assetUrls,
  deletableReleases,
  emptyRegistry,
  isClipRelease,
  readRegistry,
  reconcile,
} from "./retention";

const mode = process.argv[2];
if (!["publish", "cleanup", "plan"].includes(mode))
  throw new Error(
    "Aufruf: bun scripts/feature-videos/publish.ts plan|publish|cleanup [Release-Tag] [Medienverzeichnis]",
  );
const now = Date.now();
let media = mediaRelease();
let registry = media ? readRegistry(JSON.parse(media.body), now) : emptyRegistry(now);
if (mode === "plan") {
  const catalog = JSON.parse(readFileSync(new URL("catalog.json", import.meta.url), "utf8"));
  const pending = catalog.filter((item: { id: string; revision: string }) => {
    const previous = registry.published[item.id];
    return (
      !previous ||
      (previous.revision !== item.revision && Date.parse(previous.publishedAt) + MAX_AGE > now)
    );
  });
  process.stdout.write(JSON.stringify(pending.map((item: { id: string }) => item.id)));
  process.exit(0);
}
const incoming: FeatureVideo[] = [];
if (mode === "publish") {
  const tag = process.argv[3];
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag) || !valid(tag.slice(1)))
    throw new Error("Veröffentlichter stabiler Release-Tag fehlt");
  const release = api(`releases/tags/${tag}`);
  if (release.draft || release.prerelease)
    throw new Error("App-Release ist noch nicht veröffentlicht");
  const releasedCommit = gh(["api", `repos/${MEDIA_REPOSITORY}/commits/${tag}`, "--jq", ".sha"]);
  const directory = resolve(process.argv[4] ?? "test-artifacts/feature-videos");
  const indexPath = resolve(directory, "rendered.json");
  if (!existsSync(indexPath)) throw new Error("Aufgenommene Videos fehlen");
  const rendered = JSON.parse(readFileSync(indexPath, "utf8"));
  if (rendered.dirty !== false)
    throw new Error("Aufnahmen aus verändertem Arbeitsverzeichnis sind nur Vorschauen");
  if (rendered.commit !== releasedCommit)
    throw new Error("Aufnahmen stammen nicht aus dem veröffentlichten App-Commit");
  for (const entry of rendered.items) {
    const previous = registry.published[entry.id];
    if (
      previous?.revision === entry.revision ||
      (previous && Date.parse(previous.publishedAt) + MAX_AGE <= now)
    )
      continue;
    if (compare(tag.slice(1), entry.introducedIn) < 0) throw new Error("Feature fehlt im Release");
    execFileSync("git", ["merge-base", "--is-ancestor", entry.sourceCommit, releasedCommit]);
    const publishedAt = previous?.publishedAt ?? new Date(now).toISOString();
    const item: FeatureVideo = {
      ...entry,
      releaseVersion: tag.slice(1),
      minAppVersion: tag.slice(1),
      publishedAt,
      expiresAt: new Date(Date.parse(publishedAt) + MAX_AGE).toISOString(),
    };
    parseFeed({ ...emptyRegistry(now), items: [item] }, now);
    for (const url of assetUrls(item)) {
      const path = resolve(directory, new URL(url).pathname.split("/").at(-1)!);
      if (!path.startsWith(`${directory}/`) || !existsSync(path))
        throw new Error("Mediendatei fehlt");
      const bytes = readFileSync(path).byteLength;
      const source = item.sources.find((source) => source.url === url);
      if ((source && bytes !== source.bytes) || (!source && bytes > 100_000))
        throw new Error("Mediendateigröße ungültig");
    }
    incoming.push(item);
  }
  if (!media) {
    media = api("releases", "POST", {
      tag_name: MEDIA_TAG,
      target_commitish: releasedCommit,
      name: "Feature videos",
      body: JSON.stringify(emptyRegistry(now)),
      draft: false,
      prerelease: true,
      make_latest: "false",
    });
  }
  for (const item of incoming) {
    const tag = clipTag(item);
    let release = clipReleases().find((entry) => entry.tag_name === tag);
    if (!release) {
      release = api("releases", "POST", {
        tag_name: tag,
        target_commitish: releasedCommit,
        name: item.title,
        body: JSON.stringify({ kind: "l8db-feature-video", id: item.id, revision: item.revision }),
        draft: true,
        prerelease: true,
        make_latest: "false",
      });
    }
    if (!release || !isClipRelease(release)) throw new Error("Unbekannter Medien-Release");
    const marker = JSON.parse(release.body);
    if (marker.id !== item.id || marker.revision !== item.revision)
      throw new Error("Medien-Tag gehört zu einem anderen Feature");
    for (const url of assetUrls(item)) {
      const name = new URL(url).pathname.split("/").at(-1)!;
      const existing = releaseAssets(release.id).find((asset) => asset.name === name);
      if (existing) {
        const digest = `sha256:${createHash("sha256")
          .update(readFileSync(resolve(directory, name)))
          .digest("hex")}`;
        if (existing.digest !== digest)
          throw new Error(`Asset ${name} hat einen anderen Inhalt. Neue Revision wählen.`);
        continue;
      }
      if (!release.draft)
        throw new Error("Unvollständiger veröffentlichter Clip; neue Revision erforderlich");
      gh(["release", "upload", tag, resolve(directory, name), "--repo", MEDIA_REPOSITORY]);
    }
    if (release.draft)
      api(`releases/${release.id}`, "PATCH", {
        draft: false,
        prerelease: true,
        make_latest: "false",
      });
  }
}
if (!media) process.exit(0);
registry = reconcile(registry, incoming, now);
const releases = clipReleases();
const available = new Set<string>();
for (const release of releases) {
  if (release.draft || !isClipRelease(release)) continue;
  for (const asset of releaseAssets(release.id))
    available.add(`${ASSET_BASE}${release.tag_name}/${asset.name}`);
}
if (registry.items.flatMap(assetUrls).some((url) => !available.has(url)))
  throw new Error(
    "Aktiver Feed verweist auf fehlende Medien; keine Veröffentlichung oder Löschung",
  );
parseFeed(registry, now);
api(`releases/${media.id}`, "PATCH", {
  body: JSON.stringify(registry),
  prerelease: true,
  make_latest: "false",
});
const removable = deletableReleases(registry, releases, now);
for (const release of removable) {
  api(`releases/${release.id}`, "DELETE");
  process.stdout.write(`Entfernt: ${release.tag_name} einschließlich aller Medien\n`);
}
const remaining = new Set(clipReleases().map((release) => release.tag_name));
registry.retired = registry.retired
  .map((entry) => ({
    ...entry,
    urls: entry.urls.filter((url) => remaining.has(url.slice(ASSET_BASE.length).split("/")[0])),
  }))
  .filter((entry) => entry.urls.length);
api(`releases/${media.id}`, "PATCH", {
  body: JSON.stringify(registry),
  prerelease: true,
  make_latest: "false",
});
process.stdout.write(
  `${registry.items.length} aktive Feature-Videos; ${removable.length} alte Video-Releases entfernt.\n`,
);
