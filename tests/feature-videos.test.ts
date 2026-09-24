import { describe, expect, test } from "bun:test";
import {
  ASSET_BASE,
  DAY,
  eligibleVideos,
  type FeatureVideo,
  parseFeed,
} from "../src/lib/feature-videos/model";
import {
  assetUrls,
  deletableReleases,
  emptyRegistry,
  readRegistry,
  reconcile,
} from "../scripts/feature-videos/retention";

const now = Date.parse("2026-09-23T12:00:00Z");
export function video(overrides: Partial<FeatureVideo> = {}): FeatureVideo {
  return {
    id: "easy-mode",
    revision: "1",
    title: "Easy Mode",
    summary: "Mehr Ruhe",
    sourceCommit: "64b344ea",
    releaseVersion: "0.6.128",
    minAppVersion: "0.6.128",
    publishedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 90 * DAY).toISOString(),
    priority: 90,
    platforms: ["macos", "windows", "linux"],
    requiredCapabilities: [],
    modes: ["easy", "normal"],
    actionId: "settings",
    durationSeconds: 12,
    poster: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.jpg`,
    sources: [
      {
        url: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.mp4`,
        type: "video/mp4",
        bytes: 1000,
      },
      {
        url: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.webm`,
        type: "video/webm",
        bytes: 800,
      },
    ],
    ...overrides,
  };
}
const feed = (items = [video()]) => ({ ...emptyRegistry(now), items });
const context = { version: "0.6.132", platform: "macos", easyMode: false, capabilities: {}, now };

describe("feature feed", () => {
  test("accepts bounded media from the dedicated release", () =>
    expect(parseFeed(feed(), now).items).toHaveLength(1));
  test.each([
    { poster: "https://evil.example/fv-easy-mode-1.jpg" },
    { poster: `${ASSET_BASE}../latest.json` },
    { actionId: "delete-database" },
    { expiresAt: new Date(now + 91 * DAY).toISOString() },
    { minAppVersion: "0.6.100" },
    { maxAppVersionExclusive: "0.6.100" },
    { platforms: ["unknown"] },
    {
      sources: [
        {
          url: `${ASSET_BASE}feature-video-easy-mode-1/fv-easy-mode-1.mp4`,
          type: "video/mp4",
          bytes: 8_000_000,
        },
      ],
    },
  ])("rejects malformed or unsafe metadata %j", (patch) => {
    expect(() => parseFeed(feed([video(patch as Partial<FeatureVideo>)]), now)).toThrow();
  });
  test("rejects stale feed, excessive lifetime and duplicate ids", () => {
    expect(() => parseFeed(feed(), now + 3 * DAY)).toThrow();
    expect(() =>
      parseFeed({ ...feed(), validUntil: new Date(now + 10 * DAY).toISOString() }, now),
    ).toThrow();
    expect(() => parseFeed(feed([video(), video()]), now)).toThrow();
  });
  test("version comparison is semantic and excludes prereleases", () => {
    expect(eligibleVideos(feed(), { ...context, version: "0.6.9" })).toEqual([]);
    expect(eligibleVideos(feed(), { ...context, version: "0.6.200-beta.1" })).toEqual([]);
    expect(eligibleVideos(feed(), { ...context, version: null })).toEqual([]);
    expect(eligibleVideos(feed(), context)).toHaveLength(1);
  });
  test("filters time, capabilities, platform, mode and obsolete UI", () => {
    expect(eligibleVideos(feed(), { ...context, now: now - 1 })).toEqual([]);
    expect(eligibleVideos(feed(), { ...context, now: now + 91 * DAY })).toEqual([]);
    expect(
      eligibleVideos(feed([video({ requiredCapabilities: ["data_compare"] })]), context),
    ).toEqual([]);
    expect(
      eligibleVideos(feed([video({ requiredCapabilities: ["data_compare"] })]), {
        ...context,
        capabilities: { data_compare: true },
      }),
    ).toHaveLength(1);
    expect(
      eligibleVideos(feed([video({ modes: ["normal"] })]), { ...context, easyMode: true }),
    ).toEqual([]);
    expect(eligibleVideos(feed([video({ platforms: ["windows"] })]), context)).toEqual([]);
    expect(eligibleVideos(feed([video({ maxAppVersionExclusive: "0.6.132" })]), context)).toEqual(
      [],
    );
  });
});

describe("media retention", () => {
  const release = (id = "easy-mode", revision = "1", at = now - 3 * DAY) => ({
    id: 10,
    tag_name: `feature-video-${id}-${revision}`,
    body: JSON.stringify({ kind: "l8db-feature-video", id, revision }),
    created_at: new Date(at).toISOString(),
  });
  test("retires expired clips before deleting their entire immutable release", () => {
    const initial = reconcile(emptyRegistry(now), [video()], now);
    const later = now + 91 * DAY;
    const retired = reconcile(initial, [], later);
    expect(retired.items).toEqual([]);
    expect(deletableReleases(retired, [release()], later + DAY)).toEqual([]);
    expect(deletableReleases(retired, [release()], later + 2 * DAY)).toHaveLength(1);
    expect(retired.published["easy-mode"].publishedAt).toBe(new Date(now).toISOString());
  });
  test("keeps active releases, ignores unmarked releases and cleans abandoned drafts", () => {
    const registry = reconcile(emptyRegistry(now), [video()], now);
    expect(
      deletableReleases(
        registry,
        [
          release(),
          { ...release(), tag_name: "v0.6.132" },
          { ...release("foreign"), body: "unrelated" },
          release("orphan"),
          release("new", "1", now),
        ],
        now,
      ).map((item) => item.tag_name),
    ).toEqual(["feature-video-orphan-1"]);
  });
  test("replacement retires old formats without resetting first publication", () => {
    const initial = reconcile(emptyRegistry(now), [video()], now);
    const replacement = video({
      revision: "2",
      poster: `${ASSET_BASE}feature-video-easy-mode-2/fv-easy-mode-2.jpg`,
      sources: video().sources.map((source) => ({
        ...source,
        url: source.url.replaceAll("-1", "-2"),
      })),
    });
    const result = reconcile(initial, [replacement], now + DAY);
    expect(result.retired.flatMap((entry) => entry.urls)).toEqual(assetUrls(video()));
    expect(result.items[0].revision).toBe("2");
    expect(reconcile(result, [], now + DAY)).toEqual(result);
    expect(
      deletableReleases(result, [release(), release("easy-mode", "2")], now + 3 * DAY).map(
        (item) => item.tag_name,
      ),
    ).toEqual(["feature-video-easy-mode-1"]);
  });
  test("caps active clips at six", () => {
    expect(
      reconcile(
        emptyRegistry(now),
        Array.from({ length: 8 }, (_, index) => video({ id: `feature-${index}`, priority: index })),
        now,
      ).items,
    ).toHaveLength(6);
  });
  test("fails closed on corrupt cleanup register", () => {
    expect(() => readRegistry({ ...feed(), published: null }, now)).toThrow();
    expect(() =>
      readRegistry({ ...feed(), retired: [{ retiredAt: "invalid", urls: [] }] }, now),
    ).toThrow();
    expect(() =>
      readRegistry(
        {
          ...feed(),
          retired: [
            { retiredAt: new Date(now).toISOString(), urls: ["https://evil.example/a.mp4"] },
          ],
        },
        now,
      ),
    ).toThrow();
  });
});
