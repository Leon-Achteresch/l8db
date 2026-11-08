import { heapSize } from "bun:jsc";
import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { el, type FakeNode, fakeTarget, keyEvent } from "./discovery-help-dom";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
if (typeof host.addEventListener !== "function")
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const { collectHotkeyBadges, hotkeyBadgeLabel, MAX_HOTKEY_BADGES } = await import(
  "../src/lib/discovery/modifier-overlay/hotkey-badges"
);
const { installModifierOverlay } = await import("../src/lib/discovery/modifier-overlay/install");
const { HOTKEY_COMMANDS } = await import("../src/lib/hotkeys/commands");
const { FEATURE_CATALOG } = await import("../src/lib/discovery/catalog");
const { rankCommands } = await import("../src/lib/command-score");
const { buildFeatureItems, buildHotkeyItems } = await import(
  "../src/features/shell/app-header-search/command-items"
);

import type { CommandItem } from "../src/components/motion/command-palette/types";
import type { FeatureEntry } from "../src/lib/discovery/types";

function domTree(total: number, hotkeys: number): FakeNode {
  const ids = HOTKEY_COMMANDS.map((command) => command.id);
  const rows: FakeNode[] = [];
  let made = 0;
  let marked = 0;
  while (made < total) {
    const cells: FakeNode[] = [];
    for (let index = 0; index < 9 && made < total; index++, made++) {
      const hotkey = marked < hotkeys && made % Math.floor(total / hotkeys) === 0;
      cells.push(
        el(
          hotkey ? "button" : "span",
          hotkey ? { "data-hotkey": ids[marked++ % ids.length] } : {},
          [],
          {
            rect: {
              left: (made % 50) * 28,
              top: Math.floor(made / 50) * 24,
              width: 24,
              height: 20,
            },
          },
        ),
      );
    }
    rows.push(el("div", {}, cells));
    made++;
  }
  return el("body", {}, [el("main", {}, rows)]);
}

test("Kürzel-Overlay: 5 000 Knoten mit 300 data-hotkey", async () => {
  const root = domTree(5000, 300) as unknown as ParentNode;
  const overrides = { "query.run": "Mod+Shift+R" };
  const viewport = { width: 1440, height: 900 };
  let count = 0;
  Bun.gc(true);
  const before = heapSize();
  const result = await measureScenario(() => {
    count = collectHotkeyBadges(root, viewport, (id) => hotkeyBadgeLabel(id, overrides)).length;
  }, 31);
  Bun.gc(true);
  const retained = heapSize() - before;
  await reportScenario("discovery-help-modifier-overlay", {
    nodes: 5000,
    hotkeyElements: 300,
    badges: count,
    retainedBytes: retained,
    ...result,
  });
  expect(count).toBeLessThanOrEqual(MAX_HOTKEY_BADGES);
  expect(count).toBeGreaterThan(0);
  expect(retained).toBeLessThan(1_000_000);
  expect(result.medianMs).toBeLessThan(8);
  expect(result.p95Ms).toBeLessThan(16);
});

test("Kürzel-Overlay: keine Listener und Timer nach Unmount", async () => {
  const target = fakeTarget();
  const doc = fakeTarget();
  let shown = 0;
  for (let index = 0; index < 1000; index++) {
    const stop = installModifierOverlay({
      modifier: "Meta",
      holdMs: 1,
      onShow: () => shown++,
      onHide: () => {},
      target: target as unknown as Window,
      doc: doc as unknown as Document,
    });
    target.emit("keydown", keyEvent("Meta", { metaKey: true }));
    stop();
  }
  await Bun.sleep(10);
  await reportScenario("discovery-help-modifier-idle", {
    installs: 1000,
    listeners: target.count() + doc.count(),
    shownAfterUnmount: shown,
  });
  expect(target.count() + doc.count()).toBe(0);
  expect(shown).toBe(0);
});

function syntheticCatalog(size: number): FeatureEntry[] {
  return Array.from({ length: size }, (_, index) => {
    const base = FEATURE_CATALOG[index % FEATURE_CATALOG.length];
    return {
      ...base,
      id: `${base.id}.synthetic-${index}`,
      keywords: [...base.keywords, `k${index}`],
    };
  });
}

test("Palette-Suche mit Katalog: vorher/nachher", async () => {
  const objects: CommandItem[] = Array.from({ length: 3000 }, (_, index) => ({
    id: `object:${index}`,
    label: `tabelle_${index}_${["kunden", "auftraege", "rechnungen", "schema_log"][index % 4]}`,
    group: "Tabellen",
    keywords: [`public.tabelle_${index}`],
    onSelect() {},
  }));
  const items = [
    ...objects,
    ...buildHotkeyItems(
      "/query/1",
      true,
      () => {},
      () => {},
    ),
  ];
  const queries = [
    "wie vergleiche ich zwei schemas",
    "export",
    "kunden",
    "neu verbindung",
    "ssh tunnel",
  ];
  const large = syntheticCatalog(500);
  const baseline = await measureScenario(() => {
    for (const query of queries) rankCommands(items, query);
  }, 21);
  const withCatalog = await measureScenario(() => {
    for (const query of queries) {
      rankCommands(items, query);
      buildFeatureItems(query, false, {}, () => {});
    }
  }, 21);
  const catalogOnly = await measureScenario(() => {
    for (const query of queries) buildFeatureItems(query, false, {}, () => {});
  }, 21);
  const largeCatalog = await measureScenario(() => {
    for (const query of queries) buildFeatureItems(query, false, {}, () => {}, large);
  }, 21);
  const unused = await measureScenario(() => {
    buildFeatureItems("", true, {}, () => {}, large);
  }, 21);
  await reportScenario("discovery-help-palette", {
    items: items.length,
    queriesPerRun: queries.length,
    catalog: FEATURE_CATALOG.length,
    largeCatalog: large.length,
    baseline,
    withCatalog,
    catalogOnly,
    largeCatalogOnly: largeCatalog,
    unusedOnly: unused,
  });
  expect(catalogOnly.p95Ms / queries.length).toBeLessThan(2);
  expect(withCatalog.medianMs).toBeLessThan(baseline.medianMs + 5);
  expect(largeCatalog.p95Ms / queries.length).toBeLessThan(5);
  expect(unused.p95Ms).toBeLessThan(10);
  expect(buildFeatureItems("", true, {}, () => {}, large).length).toBeLessThanOrEqual(40);
});
