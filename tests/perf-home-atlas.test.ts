import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  ATLAS_TILE_LIMIT,
  type AtlasTable,
  atlasKey,
  atlasMetric,
  atlasNeighbors,
  joinAtlas,
  layoutAtlas,
  nextAtlasTile,
  type Rect,
  rankSchemas,
} from "../src/features/home/atlas/atlas-layout";
import type { SchemaMapLink } from "../src/lib/db/schema-map";

function overlaps(a: Rect, b: Rect) {
  const epsilon = 1e-6;
  return (
    a.x + epsilon < b.x + b.w &&
    b.x + epsilon < a.x + a.w &&
    a.y + epsilon < b.y + b.h &&
    b.y + epsilon < a.y + a.h
  );
}

function table(name: string, bytes: number | null, rows: number | null = null): AtlasTable {
  return { schema: "public", name, rows, bytes, comment: null, links: 0 };
}

test("Atlas-Kacheln füllen die Fläche lückenlos und ohne Überlappung", () => {
  const tables = [40, 22, 13, 9, 7, 4, 3, 1, 1].map((size, index) =>
    table(`t${index}`, size * 1_000_000),
  );
  const { tiles } = layoutAtlas(tables, 900, 480);
  let area = 0;
  for (const tile of tiles) {
    area += tile.w * tile.h;
    expect(tile.x).toBeGreaterThanOrEqual(-1e-9);
    expect(tile.y).toBeGreaterThanOrEqual(-1e-9);
    expect(tile.x + tile.w).toBeLessThanOrEqual(900 + 1e-6);
    expect(tile.y + tile.h).toBeLessThanOrEqual(480 + 1e-6);
    for (const other of tiles) if (other !== tile) expect(overlaps(tile, other)).toBe(false);
  }
  expect(area).toBeCloseTo(900 * 480, 3);
  expect(layoutAtlas(tables, 0, 400).tiles).toEqual([]);
});

test("Atlas verbindet Statistiken, gewichtet logarithmisch und filtert nach Namen", () => {
  const joined = joinAtlas(
    [
      { schema: "public", name: "orders" },
      { schema: "public", name: "users" },
      { schema: "public", name: "empty" },
    ],
    {
      tables: [
        { name: "orders", rows: 2_000_000, bytes: 2_000_000_000, comment: "Bestellungen" },
        { name: "users", rows: 5_000, bytes: 1_000_000, comment: null },
      ],
      links: [],
    },
  );
  expect(joined[0]).toMatchObject({ rows: 2_000_000, comment: "Bestellungen" });
  expect(joined[2]).toMatchObject({ rows: null, bytes: null });
  expect(atlasMetric(joined)).toBe("bytes");
  expect(atlasMetric([table("a", null, 3)])).toBe("rows");
  expect(atlasMetric([table("a", null)])).toBeNull();

  const layout = layoutAtlas(joined, 600, 400);
  expect(layout.tiles.map((tile) => tile.name)).toEqual(["orders", "users", "empty"]);
  const [orders, users, empty] = layout.tiles;
  expect(orders.heat).toBe(1);
  expect(empty.heat).toBe(0);
  expect(orders.w * orders.h).toBeGreaterThan(users.w * users.h);
  expect((orders.w * orders.h) / (empty.w * empty.h)).toBeLessThan(20);

  const searched = layoutAtlas(joined, 600, 400, " USE ");
  expect(searched.tiles.map((tile) => tile.name)).toEqual(["users"]);
  expect(searched.tiles[0].heat).toBe(users.heat);
  expect(searched.tiles[0].w * searched.tiles[0].h).toBeCloseTo(600 * 400, 3);
});

test("ohne lesbare Größen gewichtet der Atlas nach Fremdschlüsseln und die Schemaleiste nach Tabellenzahl", () => {
  const joined = joinAtlas(
    [
      { schema: "APP", name: "ORDERS" },
      { schema: "APP", name: "CUSTOMERS" },
      { schema: "APP", name: "AUDIT" },
    ],
    {
      tables: [],
      links: [
        { from: ["APP", "ORDERS"], to: ["APP", "CUSTOMERS"] },
        { from: ["APP", "ORDERS"], to: ["REF", "COUNTRIES"] },
        { from: ["REF", "REGIONS"], to: ["APP", "CUSTOMERS"] },
        { from: ["APP", "AUDIT"], to: ["APP", "AUDIT"] },
      ],
      warning: "ORA-00942: table or view does not exist",
    },
  );
  expect(joined.map((entry) => entry.links)).toEqual([2, 2, 0]);
  expect(atlasMetric(joined)).toBe("links");
  const layout = layoutAtlas(joined, 600, 400);
  expect(layout.metric).toBe("links");
  expect(layout.tiles.map((tile) => tile.name)).toEqual(["CUSTOMERS", "ORDERS", "AUDIT"]);
  expect(layout.tiles[0].heat).toBe(1);
  expect(layout.tiles[2].heat).toBe(0);

  const unsized = rankSchemas(["A", "B", "C"], {
    database: "XE",
    size_bytes: 0,
    size_pretty: "0 B",
    schemas: [
      { schema: "A", table_count: 3, size_bytes: 0 },
      { schema: "B", table_count: 40, size_bytes: 0 },
    ],
  });
  expect(unsized.map((entry) => [entry.name, entry.bytes, entry.tables])).toEqual([
    ["B", null, 40],
    ["A", null, 3],
    ["C", null, null],
  ]);
  expect(unsized.map((entry) => entry.share)).toEqual([1, 3 / 40, 0]);
  const sized = rankSchemas(["A", "B"], {
    database: "db",
    size_bytes: 300,
    size_pretty: "300 B",
    schemas: [
      { schema: "A", table_count: 3, size_bytes: 200 },
      { schema: "B", table_count: 40, size_bytes: 100 },
    ],
  });
  expect(sized.map((entry) => [entry.name, entry.bytes])).toEqual([
    ["A", 200],
    ["B", 100],
  ]);
  expect(rankSchemas(["Z", "A"], undefined).map((entry) => entry.name)).toEqual(["A", "Z"]);
});

test("Atlas wählt die größten Tabellen mit Namensreihenfolge bei Gleichstand", () => {
  const tables = Array.from({ length: 300 }, (_, index) =>
    table(`t${String((index * 37) % 300).padStart(3, "0")}`, ((index * 7919) % 40) * 65_536),
  );
  const expected = [...tables]
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || (a.name < b.name ? -1 : 1))
    .slice(0, ATLAS_TILE_LIMIT)
    .map((entry) => entry.name)
    .sort();
  const layout = layoutAtlas(tables, 900, 480);
  expect(layout.tiles.map((tile) => tile.name).sort()).toEqual(expected);
  expect(layout.hidden).toBe(300 - ATLAS_TILE_LIMIT);
  expect(layoutAtlas(tables, 900, 480, "", 0).tiles).toEqual([]);
});

test("Nachbarn einer Tabelle folgen den Fremdschlüsseln in beide Richtungen", () => {
  const links: SchemaMapLink[] = [
    { from: ["public", "orders"], to: ["public", "users"] },
    { from: ["public", "orders"], to: ["public", "users"] },
    { from: ["public", "orders"], to: ["auth", "accounts"] },
    { from: ["public", "reviews"], to: ["public", "orders"] },
    { from: ["public", "orders"], to: ["public", "orders"] },
  ];
  expect(atlasNeighbors(links, atlasKey("public", "orders"))).toEqual({
    outgoing: [atlasKey("public", "users"), atlasKey("auth", "accounts")],
    incoming: [atlasKey("public", "reviews")],
  });
  expect(atlasNeighbors(links, atlasKey("public", "users"))).toEqual({
    outgoing: [],
    incoming: [atlasKey("public", "orders")],
  });
});

test("Pfeiltasten wandern räumlich zur nächsten Kachel", () => {
  const tiles: Rect[] = [
    { x: 0, y: 0, w: 50, h: 100 },
    { x: 50, y: 0, w: 50, h: 50 },
    { x: 50, y: 50, w: 50, h: 50 },
  ];
  expect(nextAtlasTile(tiles, 0, "ArrowRight")).toBe(1);
  expect(nextAtlasTile(tiles, 1, "ArrowDown")).toBe(2);
  expect(nextAtlasTile(tiles, 2, "ArrowLeft")).toBe(0);
  expect(nextAtlasTile(tiles, 0, "ArrowLeft")).toBe(0);
});

test("große Schemas bleiben bei Kacheln und Layoutzeit begrenzt", async () => {
  const count = 20_000;
  const tables = Array.from({ length: count }, (_, index) =>
    table(
      `table_${String(index).padStart(5, "0")}`,
      index % 11 === 0 ? null : ((index * 7919) % 9_000_000) * 512,
      (index * 7919) % 9_000_000,
    ),
  );
  const links: SchemaMapLink[] = Array.from({ length: 60_000 }, (_, index) => ({
    from: ["public", tables[index % count].name],
    to: ["public", tables[(index * 31 + 7) % count].name],
  }));

  const infos = tables.map(({ schema, name }) => ({ schema, name }));
  const stats = tables.map(({ name, rows, bytes }) => ({ name, rows, bytes, comment: null }));
  let joined = joinAtlas(infos, { tables: stats, links });
  const joinTiming = await measureScenario(() => {
    for (let run = 0; run < 5; run++) joined = joinAtlas(infos, { tables: stats, links });
  });
  expect(joined.reduce((sum, entry) => sum + entry.links, 0)).toBe(2 * 60_000);
  const linked = layoutAtlas(
    joined.map((entry) => ({ ...entry, rows: null, bytes: null })),
    1100,
    560,
  );
  expect(linked.metric).toBe("links");
  expect(linked.tiles).toHaveLength(ATLAS_TILE_LIMIT);

  const hub = atlasKey("public", tables[7].name);
  let neighbors = atlasNeighbors(links, hub);
  const linkTiming = await measureScenario(() => {
    for (let run = 0; run < 20; run++) neighbors = atlasNeighbors(links, hub);
  });
  expect(neighbors.outgoing.length + neighbors.incoming.length).toBeGreaterThan(0);

  let layout = layoutAtlas(tables, 1100, 560);
  const layoutTiming = await measureScenario(() => {
    for (let run = 0; run < 5; run++) layout = layoutAtlas(tables, 1100, 560);
  });
  expect(layout.tiles).toHaveLength(ATLAS_TILE_LIMIT);
  expect(layout.hidden).toBe(count - ATLAS_TILE_LIMIT);
  for (const tile of layout.tiles) {
    expect(tile.x + tile.w).toBeLessThanOrEqual(1100 + 1e-6);
    expect(tile.y + tile.h).toBeLessThanOrEqual(560 + 1e-6);
  }

  let searched = layoutAtlas(tables, 1100, 560, "table_1999");
  const searchTiming = await measureScenario(() => {
    for (let run = 0; run < 5; run++) searched = layoutAtlas(tables, 1100, 560, "table_1999");
  });
  expect(searched.matching).toBe(10);

  expect(layoutTiming.p95Ms / 5).toBeLessThan(25);
  expect(searchTiming.p95Ms / 5).toBeLessThan(15);
  expect(linkTiming.p95Ms / 20).toBeLessThan(12);
  expect(joinTiming.p95Ms / 5).toBeLessThan(40);
  await reportScenario("home-atlas-layout", {
    tables: count,
    links: links.length,
    tiles: layout.tiles.length,
    layoutMedianMs: layoutTiming.medianMs / 5,
    layoutP95Ms: layoutTiming.p95Ms / 5,
    searchMedianMs: searchTiming.medianMs / 5,
    searchP95Ms: searchTiming.p95Ms / 5,
    neighborsMedianMs: linkTiming.medianMs / 20,
    neighborsP95Ms: linkTiming.p95Ms / 20,
    joinMedianMs: joinTiming.medianMs / 5,
    joinP95Ms: joinTiming.p95Ms / 5,
  });
});
