import { describe, expect, test } from "bun:test";
import { createNewFeatureStore, featureStorageKey, hasNewFeatures } from "../src/lib/new-features";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("new feature discovery", () => {
  test("only current release features propagate through their navigation path", () => {
    const seen = new Set<
      "settings.data.transfer" | "settings.about.crash-reports" | "settings.about.usage-metrics"
    >(["settings.about.crash-reports", "settings.about.usage-metrics"]);
    expect(hasNewFeatures("settings.data.transfer", seen, "0.7.0")).toBe(true);
    expect(hasNewFeatures("settings.data", seen, "0.7.0")).toBe(true);
    expect(hasNewFeatures("settings", seen, "0.7.0")).toBe(true);
    expect(hasNewFeatures("settings.dat", seen, "0.7.0")).toBe(false);
    expect(hasNewFeatures("settings", seen, "0.7.1")).toBe(false);
    seen.add("settings.data.transfer");
    expect(hasNewFeatures("settings", seen, "0.7.0")).toBe(false);
  });

  test("seeing a feature persists across store instances and updates subscribers", () => {
    const storage = memoryStorage();
    const store = createNewFeatureStore(storage, "0.7.0");
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);

    store.markSeen("settings.data.transfer");
    store.markSeen("settings.data.transfer");

    expect(notifications).toBe(1);
    expect(storage.getItem(featureStorageKey("settings.data.transfer"))).toBe("1");
    expect(
      createNewFeatureStore(storage, "0.7.0").getSnapshot().has("settings.data.transfer"),
    ).toBe(true);

    unsubscribe();
  });

  test("other windows refresh seen state and a later release ignores old badges", () => {
    const storage = memoryStorage();
    const current = createNewFeatureStore(storage, "0.7.0");
    const otherWindow = createNewFeatureStore(storage, "0.7.0");

    otherWindow.markSeen("settings.data.transfer");
    current.refresh();
    expect(current.getSnapshot().has("settings.data.transfer")).toBe(true);
    expect(createNewFeatureStore(storage, "0.7.1").getSnapshot().size).toBe(0);
  });
});
