import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ASSET_BASE, DAY } from "../src/lib/feature-videos/model";

test("publisher handles delayed draft listings, avoids republishing and limits deletion to retired media", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "l8db-video-publish-"));
  try {
    copyFileSync(resolve("tests/fixtures/feature-video-github.ts"), resolve(dir, "gh"));
    chmodSync(resolve(dir, "gh"), 0o755);
    const statePath = resolve(dir, "state.json");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    writeFileSync(
      statePath,
      JSON.stringify({ commit, media: null, assets: [], nextId: 1, events: [] }),
    );
    const base = JSON.parse(readFileSync("scripts/feature-videos/catalog.json", "utf8"))[0];
    const item = {
      ...base,
      sourceCommit: commit,
      durationSeconds: 12,
      poster: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.jpg`,
      sources: ["mp4", "webm"].map((extension) => ({
        url: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.${extension}`,
        type: `video/${extension}`,
        bytes: 4,
      })),
    };
    for (const extension of ["mp4", "webm", "jpg"])
      writeFileSync(resolve(dir, `fv-easy-mode-1.${extension}`), "demo");
    writeFileSync(
      resolve(dir, "rendered.json"),
      JSON.stringify({ commit, dirty: false, items: [item] }),
    );
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["scripts/feature-videos/publish.ts", ...args], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          FEATURE_VIDEO_MOCK_STATE: statePath,
        },
        encoding: "utf8",
      });
    const first = run("publish", "v0.6.999", dir);
    expect(first.status).toBe(0);
    let state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.events[0].assets).toHaveLength(3);
    expect(JSON.parse(state.media.body).items[0].minAppVersion).toBe("0.6.999");
    expect(run("publish", "v0.6.999", dir).status).toBe(0);
    expect(JSON.parse(run("plan").stdout)).toEqual(["extension-market"]);
    state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.assets).toHaveLength(3);
    const old = new Date(Date.now() - 100 * DAY).toISOString();
    const expired = JSON.parse(state.media.body);
    expired.items[0].publishedAt = old;
    expired.items[0].expiresAt = new Date(Date.now() - 10 * DAY).toISOString();
    expired.published["easy-mode"].publishedAt = old;
    state.media.body = JSON.stringify(expired);
    state.assets.push({ id: 100, name: "latest.json", created_at: old });
    writeFileSync(statePath, JSON.stringify(state));
    expect(run("cleanup").status).toBe(0);
    state = JSON.parse(readFileSync(statePath, "utf8"));
    const retired = JSON.parse(state.media.body);
    expect(retired.items).toHaveLength(0);
    expect(state.assets).toHaveLength(4);
    retired.retired[0].retiredAt = new Date(Date.now() - 3 * DAY).toISOString();
    state.media.body = JSON.stringify(retired);
    writeFileSync(statePath, JSON.stringify(state));
    expect(run("cleanup").status).toBe(0);
    state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.assets.map((asset: { name: string }) => asset.name)).toEqual(["latest.json"]);
    expect(JSON.parse(run("plan").stdout)).toEqual(["extension-market"]);
    state.media.body = "invalid";
    writeFileSync(statePath, JSON.stringify(state));
    expect(run("cleanup").status).not.toBe(0);
    expect(JSON.parse(readFileSync(statePath, "utf8")).assets).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
