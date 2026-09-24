#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const path = process.env.FEATURE_VIDEO_MOCK_STATE!;
const state = JSON.parse(readFileSync(path, "utf8"));
const args = process.argv.slice(2);
const output = (value: unknown) =>
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
const save = () => writeFileSync(path, JSON.stringify(state));
const flag = (name: string) => args[args.indexOf(name) + 1];
state.clips ??= [];
if (args[0] === "release") {
  if (args[1] === "upload") {
    const release = state.clips.find((item: { tag_name: string }) => item.tag_name === args[2]);
    if (!release?.draft) throw new Error("Cannot upload to immutable release");
    const data = readFileSync(args[3]);
    state.assets.push({
      id: state.nextId++,
      releaseId: release.id,
      name: basename(args[3]),
      size: data.length,
      digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
      created_at: new Date().toISOString(),
    });
  } else throw new Error("Unexpected release operation");
  save();
} else if (args[0] === "api") {
  const endpoint = args[1].replace(/^repos\/Leon-Achteresch\/l8db\//, "");
  if (endpoint === "commits/v0.6.999") output(state.commit);
  else if (endpoint === "releases/tags/v0.6.999")
    output({ draft: false, prerelease: false, immutable: true, tag_name: "v0.6.999" });
  else if (endpoint === "releases" && flag("--method") === "POST") {
    const data = JSON.parse(await Bun.stdin.text());
    if (data.make_latest !== "false") throw new Error("Media must never become latest");
    const release = {
      id: data.tag_name === "feature-videos" ? 99 : 1000 + state.clips.length,
      tag_name: data.tag_name,
      body: data.body,
      draft: data.draft,
      prerelease: data.prerelease,
      immutable: !data.draft,
      created_at: new Date().toISOString(),
    };
    if (data.tag_name === "feature-videos") state.media = release;
    else {
      state.clips.push(release);
      state.hideDraftOnce = true;
    }
    save();
    output(release);
  } else if (endpoint === "releases/tags/feature-videos") {
    if (!state.media) {
      process.stderr.write("HTTP 404\n");
      process.exit(1);
    }
    output(state.media);
  } else if (endpoint.startsWith("releases?")) {
    const clips = state.hideDraftOnce
      ? state.clips.filter((release: { draft: boolean }) => !release.draft)
      : state.clips;
    state.hideDraftOnce = false;
    save();
    output([clips]);
  } else if (/^releases\/\d+\/assets\?/.test(endpoint)) {
    const id = Number(endpoint.split("/")[1]);
    output([state.assets.filter((asset: { releaseId: number }) => asset.releaseId === id)]);
  } else if (/^releases\/\d+$/.test(endpoint) && flag("--method") === "PATCH") {
    const id = Number(endpoint.split("/")[1]);
    const data = JSON.parse(await Bun.stdin.text());
    if (data.make_latest !== "false") throw new Error("Media must never become latest");
    const release =
      id === 99 ? state.media : state.clips.find((item: { id: number }) => item.id === id);
    Object.assign(release, data);
    release.immutable = !release.draft;
    if (id === 99)
      state.events.push({
        type: "feed",
        assets: state.assets.map((asset: { name: string }) => asset.name),
      });
    save();
    output(release);
  } else if (/^releases\/\d+$/.test(endpoint) && flag("--method") === "DELETE") {
    const id = Number(endpoint.split("/")[1]);
    if (id === 99 || !state.clips.some((item: { id: number }) => item.id === id))
      throw new Error("Only whole clip releases may be deleted");
    state.events.push({ type: "delete", id });
    state.assets = state.assets.filter((asset: { releaseId: number }) => asset.releaseId !== id);
    state.clips = state.clips.filter((item: { id: number }) => item.id !== id);
    save();
  } else throw new Error(`Unexpected API: ${endpoint}`);
} else throw new Error("Unexpected command");
