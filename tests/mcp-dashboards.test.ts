import { beforeEach, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
if (typeof window === "undefined")
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
    configurable: true,
  });

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let files: Record<string, unknown>[] = [];
let saveCount = 0;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "mcp_dashboards") return files;
    if (cmd === "mcp_dashboard_save") return `saved-${++saveCount}`;
    if (cmd === "mcp_dashboard_delete") return null;
    throw new Error(`unexpected ${cmd}`);
  },
}));

const { CHARTS, useDashboardsStore } = await import("@/lib/dashboards");
const { applyMcpDashboards, pollMcpDashboards, trackMcpEdits } = await import(
  "@/lib/dashboards/mcp-sync"
);

useDashboardsStore.subscribe((state, prev) => trackMcpEdits(state.dashboards, prev.dashboards));

const dataset = {
  id: "ds1",
  name: "Status",
  mode: "expert" as const,
  simple: {
    schema: "",
    table: "",
    join: null,
    joins: [],
    dimension: null,
    dimension2: null,
    metrics: [],
    filters: [],
    dateColumn: null,
    sort: "dimension" as const,
    limit: 50,
  },
  sql: "SELECT status, COUNT(*) AS n FROM orders GROUP BY status",
  mapping: { dimension: "status", dimension2: null, metrics: ["n"], dateColumn: null },
};

function file(stamp: string, name = "Sales", id = "m1") {
  return {
    id,
    connectionId: "conn",
    name,
    refreshSec: 30,
    createdAt: 1,
    datasets: [dataset],
    widgets: [
      {
        id: "w1",
        chart: "donut" as const,
        datasetId: "ds1",
        title: "Status",
        period: "all" as const,
        options: { showPercent: true },
        x: 0,
        y: 0,
        w: 4,
        h: 8,
      },
    ],
    stamp,
  };
}

const mcpBoards = () => useDashboardsStore.getState().dashboards.filter((d) => d.mcpId);
const writes = () => calls.filter((c) => c.cmd !== "mcp_dashboards");

beforeEach(async () => {
  await Bun.sleep(450);
  useDashboardsStore.setState({ dashboards: [], active: {} });
  files = [];
  applyMcpDashboards([]);
  calls.length = 0;
});

test("imports new MCP dashboards locked and active", async () => {
  useDashboardsStore.getState().add("conn", null, "Mine");
  files = [file("s1")];
  await pollMcpDashboards();
  const [board] = mcpBoards();
  expect(board).toMatchObject({
    mcpId: "m1",
    mcpStamp: "s1",
    connectionId: "conn",
    name: "Sales",
    locked: true,
    refreshSec: 30,
  });
  expect(board.widgets[0].chart).toBe("donut");
  expect(useDashboardsStore.getState().active.conn).toBe(board.id);
  expect(useDashboardsStore.getState().dashboards).toHaveLength(2);
  await Bun.sleep(450);
  expect(writes()).toEqual([]);
});

test("unchanged stamps keep the store untouched, new stamps update in place", async () => {
  applyMcpDashboards([file("s1")]);
  const first = mcpBoards()[0];
  useDashboardsStore.getState().update(first.id, { locked: false });
  await Bun.sleep(450);
  const unlocked = mcpBoards()[0];
  applyMcpDashboards([file("s1")]);
  expect(mcpBoards()[0]).toBe(unlocked);
  applyMcpDashboards([file("s2", "Sales v2")]);
  const next = mcpBoards()[0];
  expect(next.id).toBe(first.id);
  expect(next.name).toBe("Sales v2");
  expect(next.mcpStamp).toBe("s2");
  expect(next.locked).toBe(false);
  await Bun.sleep(450);
  expect(writes()).toEqual([]);
});

test("removed files drop the dashboard without deleting anything", async () => {
  applyMcpDashboards([file("s1"), file("t1", "Other", "m2")]);
  expect(mcpBoards()).toHaveLength(2);
  applyMcpDashboards([file("t1", "Other", "m2")]);
  expect(mcpBoards().map((d) => d.mcpId)).toEqual(["m2"]);
  await Bun.sleep(450);
  expect(writes()).toEqual([]);
});

test("edits in the app are written back once, debounced", async () => {
  applyMcpDashboards([file("s1")]);
  const board = mcpBoards()[0];
  const store = useDashboardsStore.getState();
  store.update(board.id, { name: "Renamed" });
  store.update(board.id, (d) => ({ widgets: d.widgets.map((w) => ({ ...w, x: 4 })) }));
  store.update(board.id, { refreshSec: 60 });
  expect(writes()).toEqual([]);
  await Bun.sleep(450);
  expect(writes()).toHaveLength(1);
  expect(writes()[0]).toEqual({
    cmd: "mcp_dashboard_save",
    args: {
      dashboard: {
        id: "m1",
        connectionId: "conn",
        name: "Renamed",
        datasets: [dataset],
        widgets: [{ ...file("s1").widgets[0], x: 4 }],
        refreshSec: 60,
      },
    },
  });
  expect(mcpBoards()[0].mcpStamp).toBe(`saved-${saveCount}`);
  store.update(board.id, { locked: false });
  await Bun.sleep(450);
  expect(writes()).toHaveLength(1);
});

test("pending local edits are not overwritten by a poll", async () => {
  applyMcpDashboards([file("s1")]);
  const board = mcpBoards()[0];
  useDashboardsStore.getState().update(board.id, { name: "Local" });
  applyMcpDashboards([file("s2", "Remote")]);
  applyMcpDashboards([]);
  expect(mcpBoards()[0].name).toBe("Local");
  await Bun.sleep(450);
  expect(writes()[0].args).toMatchObject({ dashboard: { name: "Local" } });
});

test("deleting before the first sync still deletes the file", async () => {
  useDashboardsStore
    .getState()
    .importDashboard({ name: "Restored", mcpId: "m9", datasets: [], widgets: [] }, "conn", null);
  const board = mcpBoards()[0];
  useDashboardsStore.getState().remove(board.id);
  await Bun.sleep(450);
  expect(writes()).toEqual([{ cmd: "mcp_dashboard_delete", args: { id: "m9" } }]);
});

test("deleting in the app deletes the file, duplicates are plain dashboards", async () => {
  applyMcpDashboards([file("s1")]);
  const board = mcpBoards()[0];
  const copyId = useDashboardsStore.getState().duplicate(board.id);
  const copy = useDashboardsStore.getState().dashboards.find((d) => d.id === copyId);
  expect(copy?.mcpId).toBeNull();
  useDashboardsStore.getState().update(copyId, { name: "Copy edited" });
  useDashboardsStore.getState().remove(board.id);
  await Bun.sleep(450);
  expect(writes()).toEqual([{ cmd: "mcp_dashboard_delete", args: { id: "m1" } }]);
  applyMcpDashboards([]);
  expect(useDashboardsStore.getState().dashboards.map((d) => d.name)).toEqual(["Copy edited"]);
});

test("rust chart catalogue matches CHARTS", async () => {
  const source = await Bun.file(`${import.meta.dir}/../src-tauri/src/mcp/dashboard.rs`).text();
  const pattern =
    /Kind\s*\{\s*name:\s*"(\w+)",\s*dim:\s*"(\w+)",\s*metrics:\s*\((\d+),\s*(\d+)\),\s*size:\s*\((\d+),\s*(\d+)\),\s*options:\s*"([^"]*)"/g;
  const rust = Object.fromEntries(
    [...source.matchAll(pattern)].map((m) => [
      m[1],
      {
        dim: m[2],
        metrics: [Number(m[3]), Number(m[4])],
        w: Number(m[5]),
        h: Number(m[6]),
        options: m[7].split(" ").sort(),
      },
    ]),
  );
  const ts = Object.fromEntries(
    Object.entries(CHARTS).map(([kind, def]) => [
      kind,
      {
        dim: def.dim,
        metrics: def.metrics,
        w: def.w,
        h: def.h,
        options: [...def.options].sort(),
      },
    ]),
  );
  expect(rust).toEqual(ts);
});
