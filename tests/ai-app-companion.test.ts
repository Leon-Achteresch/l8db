import { expect, test } from "bun:test";
import {
  APP_FEATURE_CHARS,
  APP_FEATURE_LIMIT,
  type AppUiTarget,
  handleAppRequest,
  searchAppFeatures,
} from "@/lib/ai/app-companion";
import { useConnectionsStore } from "@/lib/connections";
import { FEATURE_CATALOG } from "@/lib/discovery/catalog";
import { useSettingsStore } from "@/lib/settings";

function target(): AppUiTarget {
  return { signal: new AbortController().signal, openDocs: async () => {} };
}

test("explicit feature search works for statements and stays compact", () => {
  const text = searchAppFeatures("SQL formatieren", {});
  const hits = JSON.parse(text);
  expect(hits.some((hit: { id: string }) => hit.id === "query.format")).toBe(true);
  expect(hits.length).toBeLessThanOrEqual(APP_FEATURE_LIMIT);
  expect(text.length).toBeLessThanOrEqual(APP_FEATURE_CHARS);
  expect(text).not.toContain("keywords");
  expect(searchAppFeatures("x".repeat(201), {})).toBe("[]");
  expect(searchAppFeatures("", {})).toBe("[]");
});

test("app actions validate availability, documentation paths and cancellation", async () => {
  useConnectionsStore.setState({ activeId: null, connections: [] });
  useSettingsStore.setState({ easyMode: false });
  const shown: string[] = [];
  const opened: string[] = [];
  const ui = {
    ...target(),
    openDocs: async (path: string) => {
      opened.push(path);
    },
    showFeature: async (id: string) => {
      shown.push(id);
      return "shown";
    },
  };
  const entry = FEATURE_CATALOG.find((feature) => !feature.capability && !feature.hiddenInEasyMode);
  expect(entry).toBeDefined();
  const result = await handleAppRequest({ action: "show_feature", id: entry?.id }, ui);
  expect(result.ok).toBe(true);
  expect(shown).toEqual([entry?.id]);
  expect((await handleAppRequest({ action: "show_feature", id: "unknown" }, ui)).ok).toBe(false);
  const gated = FEATURE_CATALOG.find((feature) => feature.capability);
  expect((await handleAppRequest({ action: "show_feature", id: gated?.id }, ui)).ok).toBe(false);
  expect(shown).toHaveLength(1);
  expect((await handleAppRequest({ action: "open_doc", id: "docs/sql/query-editor" }, ui)).ok).toBe(
    true,
  );
  expect(opened).toEqual(["sql/query-editor"]);
  for (const id of ["https://example.org", "docs/../secret", "docs/%2e", "docs/a?x", "docs//x"])
    expect((await handleAppRequest({ action: "open_doc", id }, ui)).ok).toBe(false);
  expect((await handleAppRequest({ action: "shell", id: entry?.id }, ui)).ok).toBe(false);
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await handleAppRequest(
        { action: "open_doc", id: "docs" },
        { ...ui, signal: controller.signal },
      )
    ).ok,
  ).toBe(false);
  expect(opened).toHaveLength(1);
  expect((await handleAppRequest({ action: "search", query: "SSH" }, ui)).ok).toBe(true);
  expect((await handleAppRequest({ action: "search", query: "" }, ui)).ok).toBe(false);
});

test("guide requests require curated steps and report missing UI honestly", async () => {
  const entry = FEATURE_CATALOG.find((feature) => feature.steps?.length && !feature.capability);
  expect(entry).toBeDefined();
  let guides = 0;
  const ui = {
    ...target(),
    guideFeature: async () => {
      guides++;
      return true;
    },
    showFeature: async () => "missing",
  };
  expect((await handleAppRequest({ action: "guide_feature", id: entry?.id }, ui)).ok).toBe(true);
  expect(guides).toBe(1);
  expect((await handleAppRequest({ action: "show_feature", id: entry?.id }, ui)).ok).toBe(false);
});

test("chat_title sets title and a real Lucide icon and rejects unknown icons", async () => {
  const titles: [string, string | undefined][] = [];
  const ui = {
    ...target(),
    setTitle: (title: string, icon?: string) => titles.push([title, icon]),
  };
  const set = await handleAppRequest(
    { action: "chat_title", title: " Langsame Abfragen ", icon: "chart-line" },
    ui,
  );
  expect(set).toEqual({ ok: true, text: "Titel gesetzt: Langsame Abfragen" });
  expect((await handleAppRequest({ action: "chat_title", title: "Nur Titel" }, ui)).ok).toBe(true);
  const unknown = await handleAppRequest(
    { action: "chat_title", title: "Kunden", icon: "not-a-lucide-icon" },
    ui,
  );
  expect(unknown.ok).toBe(false);
  expect(unknown.text).toContain("not-a-lucide-icon");
  expect(titles).toEqual([
    ["Langsame Abfragen", "chart-line"],
    ["Nur Titel", undefined],
    ["Kunden", undefined],
  ]);
  expect((await handleAppRequest({ action: "chat_title", title: "  " }, ui)).ok).toBe(false);
  expect((await handleAppRequest({ action: "chat_title", title: "x" }, target())).ok).toBe(false);
  expect(titles).toHaveLength(3);
  const long = await handleAppRequest({ action: "chat_title", title: "y".repeat(200) }, ui);
  expect(long.ok).toBe(true);
  expect(titles.at(-1)?.[0]).toHaveLength(60);
});

test("chat_title icon checks stay fast across the full Lucide catalog", async () => {
  const { readdirSync } = await import("node:fs");
  const iconNames = readdirSync("node_modules/lucide/dist/esm/icons")
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => file.slice(0, -4));
  expect(iconNames.length).toBeGreaterThan(1500);
  const { lucideIconExists } = await import("@/lib/ai/chat-icon");
  const found = await Promise.all(iconNames.map(lucideIconExists));
  expect(iconNames.filter((_, index) => !found[index])).toEqual([]);
  expect(await lucideIconExists("chart-line-")).toBe(false);
  expect(await lucideIconExists("ChartLine")).toBe(false);
  const ui = { ...target(), setTitle: () => {} };
  const measure = async (names: string[]) => {
    const timings: number[] = [];
    for (const icon of names) {
      const started = performance.now();
      await handleAppRequest({ action: "chat_title", title: "T", icon }, ui);
      timings.push(performance.now() - started);
    }
    timings.sort((a, b) => a - b);
    return [timings[Math.floor(timings.length / 2)], timings[Math.floor(timings.length * 0.95)]];
  };
  const fresh = iconNames.slice(-200);
  const [coldMedian, coldP95] = await measure(fresh);
  const [warmMedian, warmP95] = await measure(
    Array.from({ length: 1000 }, (_, index) => fresh[index % fresh.length]),
  );
  const [missingMedian] = await measure(
    Array.from({ length: 50 }, (_, index) => (index % 2 ? `missing-${index}` : "../etc/passwd")),
  );
  console.log(
    `chat_title icon check over ${iconNames.length} icons: cold median ${coldMedian.toFixed(3)} ms, p95 ${coldP95.toFixed(3)} ms; warm median ${warmMedian.toFixed(3)} ms, p95 ${warmP95.toFixed(3)} ms; missing median ${missingMedian.toFixed(3)} ms`,
  );
  expect(coldP95).toBeLessThan(25);
  expect(warmMedian).toBeLessThan(0.2);
  expect(warmP95).toBeLessThan(1);
  expect(missingMedian).toBeLessThan(25);
});
