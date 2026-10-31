import { describe, expect, test } from "bun:test";
import type { SplitTree } from "../src/lib/split-layout";
import {
  addTabs,
  closePane,
  moveTab,
  normalizeWorkspace,
  type PaneWorkspace,
  removeTabs,
  revealTab,
  singlePane,
  splitPane,
  swapPanes,
} from "../src/lib/split-panes";
import { resolveDrop } from "../src/lib/tab-drop";

const row = (...children: SplitTree[]): SplitTree => ({ dir: "row", children });
const column = (...children: SplitTree[]): SplitTree => ({ dir: "column", children });

function two(): PaneWorkspace {
  return {
    panes: ["a", "c"],
    paneTabs: [["a", "b"], ["c"]],
    masters: [null, 0],
    layout: row(null, null),
    focusedPane: 0,
  };
}

describe("Bereiche mit eigenen Tabs", () => {
  test("Tab an den rechten Rand ziehen verschiebt ihn in einen neuen Bereich", () => {
    const ws = splitPane(singlePane(["a", "b", "c"], "b"), { key: "b", target: 0, edge: "right" });
    expect(ws.paneTabs).toEqual([["a", "c"], ["b"]]);
    expect(ws.panes).toEqual(["c", "b"]);
    expect(ws.focusedPane).toBe(1);
    expect(ws.masters).toEqual([null, 0]);
    expect(ws.layout).toEqual(row(null, null));
  });

  test("der zuletzt benutzte Tab des Bereichs rückt nach", () => {
    const ws = splitPane(singlePane(["a", "b", "c"], "b"), {
      key: "b",
      target: 0,
      edge: "bottom",
      recent: ["b", "a", "c"],
    });
    expect(ws.panes).toEqual(["a", "b"]);
    expect(ws.layout).toEqual(column(null, null));
  });

  test("links oder oben einfügen setzt den neuen Bereich davor", () => {
    const ws = splitPane(singlePane(["a", "b"], "a"), { key: "b", target: 0, edge: "left" });
    expect(ws.paneTabs).toEqual([["b"], ["a"]]);
    expect(ws.focusedPane).toBe(0);
    expect(ws.masters).toEqual([1, null]);
  });

  test("einziger Tab bleibt, daneben entsteht ein leerer Bereich", () => {
    const ws = splitPane(singlePane(["a"], "a"), { key: "a", target: 0, edge: "right" });
    expect(ws.paneTabs).toEqual([["a"], []]);
    expect(ws.panes).toEqual(["a", null]);
    expect(ws.focusedPane).toBe(1);
  });

  test("Teilen eines Nachbarbereichs schließt den geleerten Quellbereich", () => {
    const ws = splitPane(two(), { key: "c", target: 0, edge: "bottom" });
    expect(ws.paneTabs).toEqual([["a", "b"], ["c"]]);
    expect(ws.layout).toEqual(column(null, null));
    expect(ws.focusedPane).toBe(1);
    expect(ws.masters).toEqual([null, 0]);
  });

  test("höchstens vier Bereiche", () => {
    let ws = singlePane(["a", "b", "c", "d", "e"], "a");
    for (const key of ["b", "c", "d", "e"])
      ws = splitPane(ws, { key, target: ws.focusedPane, edge: "right" });
    expect(ws.panes).toHaveLength(4);
    expect(ws.paneTabs).toEqual([["a", "e"], ["b"], ["c"], ["d"]]);
  });

  test("Tab in einen anderen Bereich ziehen, leerer Bereich schließt sich", () => {
    const moved = moveTab(two(), "b", 1, 0);
    expect(moved.paneTabs).toEqual([["a"], ["b", "c"]]);
    expect(moved.panes).toEqual(["a", "b"]);
    expect(moved.focusedPane).toBe(1);
    const merged = moveTab(two(), "c", 0, 1);
    expect(merged.panes).toEqual(["c"]);
    expect(merged.paneTabs).toEqual([["a", "c", "b"]]);
  });

  test("Tabs im selben Bereich umsortieren und aktivieren", () => {
    expect(moveTab(two(), "b", 0, 0).paneTabs[0]).toEqual(["b", "a"]);
    const activated = moveTab(two(), "b", 0);
    expect(activated.paneTabs[0]).toEqual(["a", "b"]);
    expect(activated.panes[0]).toBe("b");
    const middle = { ...two(), paneTabs: [["a", "b", "x"], ["c"]] };
    expect(moveTab(middle, "b", 0).paneTabs[0]).toEqual(["a", "b", "x"]);
  });

  test("Bereich schließen entfernt nur den Bereich, seine Tabs gehören keinem Bereich mehr", () => {
    const ws = { ...two(), focusedPane: 1 };
    const closed = closePane(ws, 1);
    expect(closed.paneTabs).toEqual([["a", "b"]]);
    expect(closed.panes).toEqual(["a"]);
    expect(closed.focusedPane).toBe(0);
    const three = splitPane(two(), { key: null, target: 1, edge: "bottom" });
    const kept = closePane({ ...three, focusedPane: 0 }, 2);
    expect(kept.panes).toEqual(["a", "c"]);
    expect(kept.focusedPane).toBe(0);
    expect(kept.layout).toEqual(row(null, null));
  });

  test("geschlossene Tabs verschwinden aus ihrem Bereich", () => {
    const ws = removeTabs(two(), (key) => key === "a");
    expect(ws.paneTabs).toEqual([["b"], ["c"]]);
    expect(ws.panes).toEqual(["b", "c"]);
    const emptied = removeTabs(two(), (key) => key === "c");
    expect(emptied.panes).toEqual(["a"]);
    const all = removeTabs(two(), () => true);
    expect(all.panes).toEqual([null]);
    const same = two();
    expect(removeTabs(same, () => false)).toBe(same);
  });

  test("leere Bereiche ohne Tabs bleiben beim Aufräumen stehen", () => {
    const ws = splitPane(two(), { key: null, target: 1, edge: "right" });
    expect(removeTabs(ws, (key) => key === "b").panes).toEqual(["a", "c", null]);
  });

  test("neue Tabs landen im fokussierten Bereich", () => {
    const ws = { ...two(), focusedPane: 1 };
    expect(addTabs(ws, ["d"]).paneTabs).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(addTabs(two(), ["d"], true).paneTabs[0]).toEqual(["a", "d", "b"]);
    expect(addTabs(two(), ["a"])).toEqual(two());
    const empty = splitPane(two(), { key: null, target: 1, edge: "right" });
    expect(addTabs(empty, ["d"]).panes).toEqual(["a", "c", "d"]);
  });

  test("Anzeigen fokussiert den Bereich mit dem Tab", () => {
    const ws = revealTab(two(), "c");
    expect(ws.focusedPane).toBe(1);
    expect(revealTab(two(), "b").panes).toEqual(["b", "c"]);
    const added = revealTab({ ...two(), focusedPane: 1 }, "d");
    expect(added.paneTabs[1]).toEqual(["c", "d"]);
    expect(added.panes[1]).toBe("d");
  });

  test("ein Tab ohne Bereich wird beim Teilen zum neuen Bereich", () => {
    const ws = splitPane(two(), { key: "d", target: 1, edge: "right" });
    expect(ws.paneTabs).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(ws.panes).toEqual(["a", "c", "d"]);
    expect(ws.focusedPane).toBe(2);
    expect(moveTab(two(), "d", 1).paneTabs).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("Bereiche tauschen samt Master", () => {
    const ws = swapPanes(two(), 0, 1);
    expect(ws.paneTabs).toEqual([["c"], ["a", "b"]]);
    expect(ws.masters).toEqual([1, null]);
    expect(ws.focusedPane).toBe(1);
  });

  test("gespeicherte Splits: altes Format, geschlossene und neue Tabs", () => {
    const fallback = () => row(null, null);
    const old = normalizeWorkspace(
      { panes: ["a", "c"], focusedPane: 1 },
      ["a", "b", "c"],
      () => false,
      fallback,
    );
    expect(old?.paneTabs).toEqual([["a"], ["c"]]);
    expect(old?.layout).toEqual(row(null, null));
    const closed = normalizeWorkspace(
      { panes: ["a", "x"], paneTabs: [["a"], ["x"]], focusedPane: 0 },
      ["a", "b"],
      () => false,
      fallback,
    );
    expect(closed).toBeNull();
    const remote = normalizeWorkspace(
      {
        panes: ["a", "remote"],
        paneTabs: [
          ["a", "a"],
          ["remote", "a"],
        ],
        focusedPane: 5,
      },
      ["a"],
      (key) => key === "remote",
      fallback,
    );
    expect(remote?.paneTabs).toEqual([["a"], ["remote"]]);
    expect(remote?.focusedPane).toBe(0);
    const empty = normalizeWorkspace(
      { panes: ["a", null], layout: column(null, null), focusedPane: 0 },
      ["a"],
      () => false,
      fallback,
    );
    expect(empty?.panes).toEqual(["a", null]);
    expect(empty?.layout).toEqual(column(null, null));
  });
});

describe("Ablegen auf der oberen Tab-Leiste", () => {
  test("ein Bereichs-Tab wird an der Einfügemarke gelöst", () => {
    const tabs = [
      { left: 0, right: 100 },
      { left: 104, right: 200 },
    ];
    const result = resolveDrop(
      { type: "tab", key: "c" },
      { type: "strip", pane: "master", left: 10, tabs },
      { x: 120, y: 5 },
      { paneTabs: two().paneTabs, single: [], active: null },
    );
    expect(result?.action).toEqual({ type: "detach", key: "c", at: 1 });
    expect(result?.preview).toEqual({ pane: "master", at: 1, x: 92 });
  });
});
