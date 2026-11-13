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
