import { afterEach, describe, expect, mock, test } from "bun:test";
import { el, fakeTarget, keyEvent } from "./discovery-help-dom";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
if (typeof host.addEventListener !== "function")
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const { modifierKeyFor, nextModifierPhase } = await import(
  "../src/lib/discovery/modifier-overlay/modifier-state"
);
const { installModifierOverlay } = await import("../src/lib/discovery/modifier-overlay/install");
const { collectHotkeyBadges, hotkeyBadgeLabel, MAX_HOTKEY_BADGES } = await import(
  "../src/lib/discovery/modifier-overlay/hotkey-badges"
);
const {
  cheatsheetAreas,
  cheatsheetCommands,
  featuresForRoute,
  isEditableTarget,
  matchesCheatsheetKey,
} = await import("../src/lib/discovery/cheatsheet/cheatsheet");
const { catalogEntryForFeature, describeElementForIssue, resolveWhatsThis } = await import(
  "../src/lib/discovery/whats-this/whats-this"
);
const { FEATURE_CATALOG, featureById } = await import("../src/lib/discovery/catalog");
const { useFeatureUsageStore } = await import("../src/lib/discovery/usage");
const { formatHotkeyDisplay } = await import("../src/lib/hotkeys/display");
const { commandById } = await import("../src/lib/hotkeys/commands");
const { detectHotkeyConflicts } = await import("../src/lib/hotkeys/conflicts");
const { parsePaletteQuery, withQueryItems } = await import("../src/lib/command-palette-search");
const { buildFeatureItems, buildHotkeyItems } = await import(
  "../src/features/shell/app-header-search/command-items"
);

type Down = Parameters<typeof nextModifierPhase>[1] & { type: "keydown" };

function down(key: string, extra: Partial<Down> = {}): Down {
  return {
    type: "keydown",
    key,
    ctrlKey: key === "Control",
    metaKey: key === "Meta",
    altKey: false,
    shiftKey: false,
    repeat: false,
    altGraph: false,
    ...extra,
  };
}

function run(
  inputs: Parameters<typeof nextModifierPhase>[1][],
  modifier: "Meta" | "Control" = "Meta",
) {
  return inputs.reduce(
    (phase, input) => nextModifierPhase(phase, input, modifier),
    "idle" as const as ReturnType<typeof nextModifierPhase>,
  );
}

describe("Modifier halten", () => {
  test("Plattform bestimmt die Taste", () => {
    expect(modifierKeyFor("mac")).toBe("Meta");
    expect(modifierKeyFor("windows")).toBe("Control");
    expect(modifierKeyFor("linux")).toBe("Control");
  });

  test("Halten zeigt, Loslassen blendet aus", () => {
    expect(run([down("Meta")])).toBe("holding");
    expect(run([down("Meta"), { type: "elapsed" }])).toBe("shown");
    expect(run([down("Meta"), down("Meta", { repeat: true }), { type: "elapsed" }])).toBe("shown");
    expect(run([down("Meta"), { type: "elapsed" }, { type: "keyup" }])).toBe("idle");
  });

  test("andere Taste, Maus, blur brechen ab", () => {
    expect(run([down("Meta"), down("k", { metaKey: true }), { type: "elapsed" }])).toBe("idle");
    expect(
      run([down("Meta"), { type: "elapsed" }, down("Shift", { metaKey: true, shiftKey: true })]),
    ).toBe("idle");
    expect(run([down("Meta"), { type: "cancel" }, { type: "elapsed" }])).toBe("idle");
    expect(run([down("Meta"), { type: "elapsed" }, { type: "cancel" }])).toBe("idle");
  });

  test("AltGr unter Windows löst nichts aus", () => {
    const altGr = [
      down("Control"),
      down("AltGraph", { ctrlKey: true, altKey: true, altGraph: true }),
      down("Control", { repeat: true }),
      { type: "elapsed" as const },
    ];
    expect(run(altGr, "Control")).toBe("idle");
    expect(run([down("Control", { altGraph: true }), { type: "elapsed" }], "Control")).toBe("idle");
    expect(run([down("Control", { repeat: true }), { type: "elapsed" }], "Control")).toBe("idle");
    expect(run([down("Meta"), { type: "elapsed" }], "Control")).toBe("idle");
    expect(run([down("Control"), { type: "elapsed" }], "Control")).toBe("shown");
  });

  test("Installation zeigt nach Halten und räumt vollständig auf", async () => {
    const target = fakeTarget();
    const doc = fakeTarget();
    const events: string[] = [];
    const stop = installModifierOverlay({
      modifier: "Meta",
      holdMs: 5,
      onShow: () => events.push("show"),
      onHide: () => events.push("hide"),
      target: target as unknown as Window,
      doc: doc as unknown as Document,
    });
    target.emit("keydown", keyEvent("Meta", { metaKey: true }));
    await Bun.sleep(20);
    expect(events).toEqual(["show"]);
    target.emit("pointerdown");
    expect(events).toEqual(["show", "hide"]);
    target.emit("keydown", keyEvent("Meta", { metaKey: true }));
    target.emit("keydown", keyEvent("c", { metaKey: true }));
    await Bun.sleep(20);
    expect(events).toEqual(["show", "hide"]);
    target.emit("keydown", keyEvent("Meta", { metaKey: true }));
    await Bun.sleep(20);
    stop();
    expect(events).toEqual(["show", "hide", "show", "hide"]);
    expect(target.count() + doc.count()).toBe(0);
    target.emit("keydown", keyEvent("Meta", { metaKey: true }));
    await Bun.sleep(20);
    expect(events).toHaveLength(4);
  });
});

describe("Kürzel-Badges", () => {
  const viewport = { width: 1000, height: 800 };
  afterEach(() => useFeatureUsageStore.getState().reset());

  test("Limit, Viewport und unsichtbare Elemente", () => {
    const buttons = Array.from({ length: 200 }, (_, index) =>
      el("button", { "data-hotkey": "query.run" }, [], {
        rect: { left: (index % 20) * 40, top: Math.floor(index / 20) * 30, width: 30, height: 20 },
      }),
    );
    const root = el("body", {}, [
      el("div", {}, buttons),
      el("button", { "data-hotkey": "query.run" }, [], {
        rect: { left: 10, top: 900, width: 30, height: 20 },
      }),
    ]);
    const badges = collectHotkeyBadges(root as unknown as ParentNode, viewport, () => "⌘↵");
    expect(badges).toHaveLength(MAX_HOTKEY_BADGES);
    for (const badge of badges) {
      expect(badge.left).toBeGreaterThanOrEqual(16);
      expect(badge.top).toBeLessThanOrEqual(viewport.height - 10);
    }
    const hidden = el("body", {}, [
      el("div", { "aria-hidden": "true" }, [el("button", { "data-hotkey": "query.run" })]),
      el("button", { "data-hotkey": "query.run" }, [], {
        rect: { left: 0, top: 0, width: 0, height: 0 },
      }),
      el("button", { "data-hotkey": "unbekannt" }),
    ]);
    expect(
      collectHotkeyBadges(hidden as unknown as ParentNode, viewport, (id) =>
        hotkeyBadgeLabel(id, {}),
      ),
    ).toEqual([]);
  });

  test("offener Dialog zeigt nur eigene Kürzel", () => {
    const root = el("body", {}, [
      el("button", { "data-hotkey": "query.run" }),
      el("div", { role: "dialog", "data-state": "open" }, [
        el("button", { "data-hotkey": "query.format" }),
      ]),
    ]);
    const badges = collectHotkeyBadges(root as unknown as ParentNode, viewport, (id) =>
      hotkeyBadgeLabel(id, {}),
    );
    expect(badges.map((badge) => badge.id)).toEqual(["query.format"]);
  });

  test("Nutzer-Overrides gewinnen", () => {
    expect(hotkeyBadgeLabel("query.run", { "query.run": "Mod+Shift+R" })).toBe(
      formatHotkeyDisplay("Mod+Shift+R"),
    );
    expect(hotkeyBadgeLabel("query.run", {})).toBe(
      formatHotkeyDisplay(commandById("query.run")?.defaultHotkey ?? ""),
    );
    expect(hotkeyBadgeLabel("gibt.es.nicht", {})).toBeNull();
  });
});

describe("Spickzettel", () => {
  test("? öffnet auf deutscher und US-Tastatur", () => {
    expect(matchesCheatsheetKey(keyEvent("?", { shiftKey: true }, "Minus"), "?", "mac")).toBe(true);
    expect(matchesCheatsheetKey(keyEvent("?", { shiftKey: true }, "Slash"), "?", "windows")).toBe(
      true,
    );
    expect(matchesCheatsheetKey(keyEvent("ß", {}, "Minus"), "?", "mac")).toBe(false);
    expect(matchesCheatsheetKey(keyEvent("/", {}, "Slash"), "?", "windows")).toBe(false);
    expect(
      matchesCheatsheetKey(keyEvent("?", { ctrlKey: true, altKey: true }, "Minus"), "?", "windows"),
    ).toBe(false);
    expect(matchesCheatsheetKey(keyEvent("F2", {}, "F2"), "F2", "mac")).toBe(true);
  });

  test("nicht in Eingabefeldern, Monaco oder contenteditable", () => {
    expect(isEditableTarget(el("input") as unknown as Element)).toBe(true);
    expect(isEditableTarget(el("textarea") as unknown as Element)).toBe(true);
    const monaco = el("div", {}, [el("div", { role: "presentation" })], {
      classes: ["monaco-editor"],
    });
    expect(isEditableTarget(monaco.children[0] as unknown as Element)).toBe(true);
    const editable = el("div", { contenteditable: "true" }, [el("span")]);
    expect(isEditableTarget(editable.children[0] as unknown as Element)).toBe(true);
    expect(isEditableTarget(el("button") as unknown as Element)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  test("Kürzel und Funktionen der Ansicht", () => {
    expect(cheatsheetAreas("/query/abc")[0]).toBe("SQL-Editor");
    expect(cheatsheetAreas("/tables/public/users")[0]).toBe("Datengitter");
    const queryGroups = cheatsheetCommands("/query/abc", "");
    expect(queryGroups[0].area).toBe("SQL-Editor");
    const homeAreas = cheatsheetCommands("/", "").map((group) => group.area);
    expect(homeAreas).not.toContain("SQL-Editor");
    expect(
      cheatsheetCommands("/", "Spickzettel").flatMap((group) => group.commands.map((c) => c.id)),
    ).toContain("help.cheatsheet");
    const queryFeatures = featuresForRoute("/query/abc", "");
    expect(queryFeatures.length).toBeGreaterThan(5);
    expect(queryFeatures.every((entry) => entry.route?.startsWith("/query"))).toBe(true);
    const tableFeatures = featuresForRoute("/tables/public/users", "");
    expect(tableFeatures.every((entry) => entry.area === "Daten & Tabellen")).toBe(true);
    const searched = featuresForRoute("/query/abc", "formatieren");
    expect(searched.length).toBeGreaterThan(0);
    expect(searched.length).toBeLessThanOrEqual(queryFeatures.length);
  });

  test("neue Befehle kollidieren nicht", () => {
    expect(detectHotkeyConflicts({})).toEqual([]);
    expect(commandById("help.whatsThis")?.defaultHotkey).toBe("Mod+Shift+H");
    expect(commandById("help.cheatsheet")?.defaultHotkey).toBe("?");
  });
});

describe("Was ist das?", () => {
  const first =
    FEATURE_CATALOG.find((entry) => entry.hotkey && !entry.anchor) ?? FEATURE_CATALOG[0];

  test("nächster bekannter Vorfahre gewinnt", () => {
    const button = el("button", {}, [], { text: "Los" });
    el("div", { "data-feature": "connections.add" }, [
      el("div", { "data-feature": "unbekannt.x" }, [button]),
    ]);
    const match = resolveWhatsThis(button as unknown as Element);
    expect(match.entry?.id).toBe("connections.add");
    expect(match.feature).toBe("unbekannt.x");
  });

  test("data-hotkey ordnet über den Katalog zu", () => {
    const icon = el("svg");
    el("button", { "data-hotkey": first.hotkey as string }, [icon]);
    const match = resolveWhatsThis(icon as unknown as Element);
    expect(match.entry?.hotkey).toBe(first.hotkey);
    expect(match.hotkey).toBe(first.hotkey as string);
  });

  test("Unter-IDs fallen auf das Eltern-Feature zurück", () => {
    expect(catalogEntryForFeature("connections.add.extra.teil")?.id).toBe("connections.add");
    expect(catalogEntryForFeature("gibt.es.nicht")).toBeUndefined();
  });

  test("kein Treffer", () => {
    const lonely = el("span");
    el("div", { "data-feature": "zzz.unbekannt" }, [lonely]);
    const match = resolveWhatsThis(lonely as unknown as Element);
    expect(match.entry).toBeNull();
    expect(match.feature).toBe("zzz.unbekannt");
    const nothing = resolveWhatsThis(el("p") as unknown as Element);
    expect(nothing).toEqual({ entry: null, feature: null, hotkey: null, anchor: null });
  });

  test("Abbruch per Escape und Signal", async () => {
    const win = fakeTarget();
    const removed: string[] = [];
    const node = () => ({
      dataset: {},
      style: {},
      textContent: "",
      append() {},
      remove: () => removed.push("node"),
    });
    const previous = {
      document: globalThis.document,
      add: host.addEventListener,
      remove: host.removeEventListener,
    };
    Object.assign(globalThis, {
      document: { createElement: node, head: { append() {} }, body: { append() {} } },
    });
    Object.assign(host, {
      addEventListener: win.addEventListener,
      removeEventListener: win.removeEventListener,
    });
    try {
      const { pickElement } = await import("../src/lib/dom-picker");
      const escaped = pickElement();
      win.emit("keydown", { key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
      expect(await escaped).toBeNull();
      const controller = new AbortController();
      const aborted = pickElement(controller.signal);
      controller.abort();
      expect(await aborted).toBeNull();
      expect(win.count()).toBe(0);
      expect(removed.length).toBe(4);
    } finally {
      Object.assign(globalThis, { document: previous.document });
      Object.assign(host, { addEventListener: previous.add, removeEventListener: previous.remove });
    }
  });

  test("Issue-Beschreibung enthält keine Zellwerte", () => {
    const cell = el("span", {}, [], { text: "geheim-4711" });
    el("table", {}, [el("tr", {}, [el("td", { "data-feature": "query.run" }, [cell])])]);
    const text = describeElementForIssue(
      cell as unknown as Element,
      "/tables/public/users",
      resolveWhatsThis(cell as unknown as Element),
    );
    expect(text).not.toContain("geheim");
    expect(text).toContain("<span>");
    expect(text).toContain("Ansicht: /tables/public/users");
    const gridButton = el("button", { "aria-label": "4711 Euro" });
    el("div", { role: "grid" }, [el("div", { role: "row" }, [gridButton])]);
    expect(
      describeElementForIssue(
        gridButton as unknown as Element,
        "/query",
        resolveWhatsThis(gridButton as unknown as Element),
      ),
    ).not.toContain("4711");
    const run = el("button", { "data-hotkey": "query.run" }, [], {
      text: `Ausführen ${"x".repeat(200)}`,
    });
    const described = describeElementForIssue(
      run as unknown as Element,
      "/query/1?x=geheim",
      resolveWhatsThis(run as unknown as Element),
    );
    expect(described).toContain("„Abfrage ausführen“");
    expect(described).not.toContain("xxx");
    expect(described).toContain("Kürzel-Befehl: query.run");
    expect(described).not.toContain("geheim");
    expect(described.length).toBeLessThan(400);
    const unknown = el("div", { "data-feature": "zzz" }, [], { text: "Hallo" });
    expect(
      describeElementForIssue(
        unknown as unknown as Element,
        "/",
        resolveWhatsThis(unknown as unknown as Element),
      ),
    ).toContain("nicht im Katalog");
    const tab = el("button", { role: "tab", title: "kunden_geheim: prod" }, [], {
      text: "kunden_geheim: prod",
    });
    el("div", { "data-feature": "tabs.zzz" }, [tab]);
    const tabText = describeElementForIssue(
      tab as unknown as Element,
      "/",
      resolveWhatsThis(tab as unknown as Element),
    );
    expect(tabText).not.toContain("kunden_geheim");
    expect(tabText).toContain("<button> role=tab");
  });
});

describe("Palette erklärt sich", () => {
  afterEach(() => useFeatureUsageStore.getState().reset());

  test("neu:-Präfix", () => {
    expect(parsePaletteQuery("neu: export", true, true)).toEqual({
      commandsOnly: false,
      unusedOnly: true,
      search: "export",
    });
    expect(parsePaletteQuery("NEU:", true, true).unusedOnly).toBe(true);
    expect(parsePaletteQuery("neu: export", true, false).unusedOnly).toBe(false);
    expect(parsePaletteQuery("> neu: x", true, true).commandsOnly).toBe(true);
    expect(parsePaletteQuery("neuer tab", true, true).unusedOnly).toBe(false);
  });

  test("Fragen in Alltagssprache finden das Feature", () => {
    const items = buildFeatureItems("wie vergleiche ich zwei Schemas", false, {}, () => {});
    expect(items.map((item) => item.id)).toContain("feature:schema-compare");
    expect(items.every((item) => item.group === "Funktionen" && item.summary)).toBe(true);
    expect(items[0].featureId).toBeDefined();
    expect(buildFeatureItems("   ", false, {}, () => {})).toEqual([]);
  });

  test("Noch nie genutzt filtert genutzte Funktionen", () => {
    const all = buildFeatureItems("", true, {}, () => {});
    expect(all.length).toBeGreaterThan(0);
    const used = all[0].id.slice("feature:".length);
    useFeatureUsageStore.getState().record(used);
    const rest = buildFeatureItems("", true, {}, () => {});
    expect(rest.map((item) => item.id)).not.toContain(`feature:${used}`);
    expect(featureById(used)).toBeDefined();
  });

  test("Befehle mit Katalog-Feature tragen die Kurzbeschreibung", () => {
    const items = buildHotkeyItems(
      "/query/1",
      true,
      () => {},
      () => {},
    );
    const run = items.find((item) => item.id === "hotkey:query.run");
    expect(run?.summary).toBe(featureById("query.run")?.summary);
    expect(
      withQueryItems(run ? [run] : [], [
        ...(run ? [run] : []),
        { id: "x", label: "x", onSelect() {} },
      ]).map((i) => i.id),
    ).toEqual(["hotkey:query.run", "x"]);
  });
});
