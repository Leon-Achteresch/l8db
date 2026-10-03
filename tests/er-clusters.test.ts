import { describe, expect, test } from "bun:test";
import { buildEdges, buildNodes } from "../src/features/er-diagram/er-diagram-view/build-graph";
import {
  buildClusterFrames,
  fitClusterLayout,
} from "../src/features/er-diagram/er-diagram-view/cluster-layout";
import { visibleClusterIds } from "../src/features/er-diagram/er-diagram-view/cluster-visibility";
import {
  CLUSTER_DETAIL_ZOOM,
  CLUSTER_HEADER_HEIGHT,
  CLUSTER_MAX_TABLES,
  NODE_WIDTH,
} from "../src/features/er-diagram/er-diagram-view/constants";
import { getDiagramBounds } from "../src/features/er-diagram/er-diagram-view/export-utils";
import { estimateNodeHeight } from "../src/features/er-diagram/er-diagram-view/node-dimensions";
import { buildRoutedEdges } from "../src/features/er-diagram/er-diagram-view/route-edges";
import {
  type ErPoint,
  routeRelationship,
  segmentHitsObstacle,
} from "../src/features/er-diagram/er-diagram-view/route-relationship";
import type { ERTable, ForeignKeyInfo } from "../src/lib/db";
import { buildErClusters } from "../src/lib/er-clusters";
import { erTableKeyOf } from "../src/lib/er-focus";

function table(name: string, schema = "public", columns = 4): ERTable {
  return {
    schema,
    name,
    columns: Array.from({ length: columns }, (_, index) => ({
      name: index === 0 ? "id" : `col_${index}`,
      data_type: "integer",
      is_primary_key: index === 0,
      is_nullable: false,
    })),
  };
}

function fk(from: ERTable, to: ERTable, name = `${from.name}_${to.name}_fk`): ForeignKeyInfo {
  return {
    constraint_name: name,
    from_schema: from.schema,
    from_table: from.name,
    from_column: "col_1",
    to_schema: to.schema,
    to_table: to.name,
    to_column: "id",
  };
}

function clique(tables: ERTable[]): ForeignKeyInfo[] {
  return tables.flatMap((from, index) => tables.slice(index + 1).map((to) => fk(from, to)));
}

describe("ER clusters", () => {
  test("cluster titles describe shared entities and give technical tables distinct group names", () => {
    const orders = [table("orders"), table("order_items"), table("products")];
    expect(
      buildErClusters({
        tables: orders,
        foreign_keys: [fk(orders[1], orders[0]), fk(orders[1], orders[2])],
      }).clusters[0].label,
    ).toBe("Bestellungen & Positionen");
    const tables = Array.from({ length: 60 }, (_, index) => table(`table_${index}`));
    const clusters = buildErClusters({
      tables,
      foreign_keys: tables.slice(1).map((entry, index) => fk(entry, tables[Math.floor(index / 3)])),
    }).clusters;
    expect(
      clusters.every((cluster) => cluster.label.startsWith("Public · Beziehungsgruppe ")),
    ).toBe(true);
    expect(new Set(clusters.map((cluster) => cluster.label)).size).toBe(clusters.length);
    const semantic = table("table_0001");
    semantic.columns[1].name = "customer_id";
    semantic.columns[2].name = "order_id";
    expect(buildErClusters({ tables: [semantic], foreign_keys: [] }).clusters[0].label).toBe(
      "Bestellungen & Kunden",
    );
  });
  test("dense groups stay together and a weak bridge remains visible between frames", () => {
    const sales = ["orders", "items", "customers", "products"].map((name) => table(name));
    const auth = ["users", "roles", "permissions", "sessions"].map((name) => table(name));
    const bridge = fk(sales[0], auth[0]);
    const result = buildErClusters({
      tables: [...sales, ...auth],
      foreign_keys: [...clique(sales), ...clique(auth), bridge],
    });
    expect(result.clusters).toHaveLength(2);
    expect(
      new Set(
        result.clusters
          .find((cluster) => cluster.tables.includes(auth[0]))
          ?.tables.map(erTableKeyOf),
      ),
    ).toEqual(new Set(auth.map(erTableKeyOf)));
    expect(
      new Set(
        result.clusters
          .find((cluster) => cluster.tables.includes(sales[0]))
          ?.tables.map(erTableKeyOf),
      ),
    ).toEqual(new Set(sales.map(erTableKeyOf)));
    expect(result.links).toHaveLength(1);
    expect(result.links[0].foreignKeys).toEqual([bridge]);
  });

  test("a large connected graph is bounded and every relationship is retained", () => {
    const tables = Array.from({ length: 1000 }, (_, index) =>
      table(`t_${String(index).padStart(4, "0")}`),
    );
    const foreign_keys = tables
      .slice(1)
      .map((entry, index) => fk(entry, tables[Math.floor(index / 3)]));
    const result = buildErClusters({ tables, foreign_keys });
    const members = result.clusters.flatMap((cluster) => cluster.tables.map(erTableKeyOf));
    expect(members).toHaveLength(tables.length);
    expect(new Set(members).size).toBe(tables.length);
    expect(result.clusters.every((cluster) => cluster.tables.length <= CLUSTER_MAX_TABLES)).toBe(
      true,
    );
    expect(
      result.clusters.flatMap((cluster) => cluster.foreignKeys).length +
        result.links.flatMap((link) => link.foreignKeys).length,
    ).toBe(foreign_keys.length);
  });

  test("isolated tables are grouped per schema and self references remain relationships", () => {
    const isolated = Array.from({ length: 60 }, (_, index) => table(`plain_${index}`));
    const otherSchema = table("plain_0", "other");
    const self = table("tree");
    const missing = table("missing");
    const result = buildErClusters({
      tables: [...isolated, otherSchema, self],
      foreign_keys: [fk(self, self), fk(isolated[0], missing)],
    });
    expect(result.clusters.filter((cluster) => cluster.isolated)).toHaveLength(4);
    expect(
      result.clusters.every(
        (cluster) => new Set(cluster.tables.map((entry) => entry.schema)).size === 1,
      ),
    ).toBe(true);
    expect(result.clusters.find((cluster) => !cluster.isolated)?.foreignKeys).toHaveLength(1);
    expect(result.links).toHaveLength(0);
  });

  test("partition and frame identifiers do not depend on metadata order", () => {
    const tables = Array.from({ length: 70 }, (_, index) => table(`table_${index}`));
    const foreign_keys = tables
      .slice(1)
      .map((entry, index) => fk(entry, tables[Math.floor(index / 3)]));
    const schema = { tables, foreign_keys };
    expect(buildErClusters(schema)).toEqual(
      buildErClusters({ tables: [...tables].reverse(), foreign_keys: [...foreign_keys].reverse() }),
    );
  });

  test("empty schemas produce an empty overview", () => {
    expect(buildErClusters({ tables: [], foreign_keys: [] })).toEqual({ clusters: [], links: [] });
    expect(buildClusterFrames([])).toEqual([]);
  });

  test("constraint names on different tables and schemas remain distinct", () => {
    const a = table("items");
    const b = table("items", "sales");
    const target = table("orders");
    const first = fk(a, target, "parent_fk");
    const composite = { ...first, from_column: "col_2", to_column: "col_2" };
    const second = fk(b, target, "parent_fk");
    const edges = buildEdges([first, composite, second]);
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(2);
    expect(edges[0].label).toBe("col_1 → id, col_2 → col_2");
  });
});

describe("ER frame geometry and visibility", () => {
  test("uneven and very tall tables fit without overlapping or changing frame bounds", () => {
    const tables = Array.from({ length: 80 }, (_, index) =>
      table(`table_${index}`, "public", index % 11 === 0 ? 120 : 4),
    );
    const frames = buildClusterFrames(buildErClusters({ tables, foreign_keys: [] }).clusters);
    for (const frame of frames) {
      const rectangles = frame.cluster.tables.map((entry) => {
        const position = frame.positions.get(erTableKeyOf(entry));
        expect(position).toBeDefined();
        const rect = {
          x: position?.x ?? 0,
          y: position?.y ?? 0,
          width: NODE_WIDTH,
          height: estimateNodeHeight(entry),
        };
        expect(rect.x + rect.width).toBeLessThanOrEqual(frame.width);
        expect(rect.y).toBeGreaterThanOrEqual(CLUSTER_HEADER_HEIGHT);
        expect(rect.y + rect.height).toBeLessThanOrEqual(frame.height);
        return rect;
      });
      for (const [index, a] of rectangles.entries()) {
        for (const b of rectangles.slice(index + 1))
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          ).toBe(true);
      }
    }
    for (const [index, a] of frames.entries()) {
      for (const b of frames.slice(index + 1))
        expect(
          a.position.x + a.width <= b.position.x ||
            b.position.x + b.width <= a.position.x ||
            a.position.y + a.height <= b.position.y ||
            b.position.y + b.height <= a.position.y,
        ).toBe(true);
    }
    const frame = frames[0];
    const oversized = new Map(
      frame.cluster.tables.map((entry, index) => [erTableKeyOf(entry), { x: index * 1000, y: 0 }]),
    );
    expect(fitClusterLayout(frame, oversized)).toBe(frame.positions);
    expect(fitClusterLayout(frame, new Map())).toBe(frame.positions);
    expect(
      fitClusterLayout(
        frame,
        new Map(frame.cluster.tables.map((entry) => [erTableKeyOf(entry), { x: 0, y: 0 }])),
      ),
    ).toBe(frame.positions);
  });

  test("overview zoom never requests table layouts", () => {
    const frames = [{ id: "one", position: { x: 0, y: 0 }, width: 1000, height: 1000 }];
    expect(
      visibleClusterIds(frames, { x: 0, y: 0, zoom: CLUSTER_DETAIL_ZOOM - 0.01 }, 1200, 800),
    ).toEqual([]);
  });

  test("scrolling loads only nearby frames, including a frame enclosing the viewport", () => {
    const frames = [
      { id: "one", position: { x: 0, y: 0 }, width: 2000, height: 2000 },
      { id: "two", position: { x: 3000, y: 0 }, width: 1000, height: 1000 },
      { id: "three", position: { x: 6000, y: 0 }, width: 1000, height: 1000 },
    ];
    expect(visibleClusterIds(frames, { x: -500, y: -500, zoom: 1 }, 800, 600)).toEqual(["one"]);
    expect(visibleClusterIds(frames, { x: -3000, y: 0, zoom: 1 }, 800, 600)).toEqual(["two"]);
    expect(visibleClusterIds(frames, { x: -5000, y: 0, zoom: 1 }, 800, 600)).toEqual([]);
    expect(visibleClusterIds(frames, { x: 0, y: 0, zoom: 1 }, 0, 600)).toEqual([]);
  });
});

describe("ER relationship routing", () => {
  test("export bounds include routes outside cluster frames", () => {
    expect(
      getDiagramBounds({ x: 0, y: 0, width: 1000, height: 800 }, [
        {
          id: "outer",
          source: "a",
          target: "b",
          data: {
            points: [
              { x: -60, y: 200 },
              { x: 1084, y: -24 },
              { x: 400, y: 824 },
            ],
          },
        },
      ]),
    ).toEqual({ x: -60, y: -24, width: 1144, height: 848 });
  });
  test("relationships to distant clusters remain visible without mounting their tables", () => {
    const left = ["a", "b", "c", "d"].map((name) => table(name));
    const right = ["e", "f", "g", "h"].map((name) => table(name));
    const frames = buildClusterFrames(
      buildErClusters({
        tables: [...left, ...right],
        foreign_keys: [...clique(left), ...clique(right), fk(left[0], right[0])],
      }).clusters,
    );
    const frame = frames.find((entry) => entry.cluster.tables.includes(left[0]));
    expect(frame).toBeDefined();
    if (!frame) return;
    const loaded = new Map([
      [
        frame.cluster.id,
        buildNodes(frame.cluster.tables, frame.cluster.relatedForeignKeys, frame.positions).map(
          (node, index) => ({ ...node, height: estimateNodeHeight(frame.cluster.tables[index]) }),
        ),
      ],
    ]);
    const edges = buildRoutedEdges(
      frames,
      loaded,
      new Set([frame.cluster.id]),
      new Set([erTableKeyOf(left[0])]),
      false,
    );
    expect(edges).toHaveLength(7);
    expect(edges.filter((edge) => edge.data?.highlighted)).toHaveLength(4);
    expect(edges.filter((edge) => edge.target.startsWith("cluster:"))).toHaveLength(1);
    expect(loaded.size).toBe(1);
  });

  test("orthogonal paths bypass intervening tables and retain self references", () => {
    const obstacles = [
      { x: 0, y: 0, width: 240, height: 160 },
      { x: 340, y: 0, width: 240, height: 400 },
      { x: 680, y: 0, width: 240, height: 160 },
    ];
    for (const target of [
      { x: 676, y: 100 },
      { x: -4, y: 50 },
    ]) {
      const points = routeRelationship({ x: 244, y: 100 }, target, obstacles);
      expect(points).not.toBeNull();
      for (let index = 1; index < (points?.length ?? 0); index++) {
        const from = points?.[index - 1] as ErPoint;
        const to = points?.[index] as ErPoint;
        expect(from.x === to.x || from.y === to.y).toBe(true);
        expect(obstacles.some((rect) => segmentHitsObstacle(from, to, rect, 0))).toBe(false);
      }
    }
  });

  test("all exported relationships survive routing across frames without crossing tables", () => {
    const tables = Array.from({ length: 120 }, (_, index) =>
      table(`t_${String(index).padStart(4, "0")}`, "public", index % 17 === 0 ? 30 : 4),
    );
    const foreign_keys = tables
      .slice(1)
      .map((entry, index) => fk(entry, tables[Math.floor(index / 3)]));
    const frames = buildClusterFrames(buildErClusters({ tables, foreign_keys }).clusters);
    const loaded = new Map(
      frames.map((frame) => [
        frame.cluster.id,
        buildNodes(frame.cluster.tables, frame.cluster.relatedForeignKeys, frame.positions).map(
          (node, index) => ({ ...node, height: estimateNodeHeight(frame.cluster.tables[index]) }),
        ),
      ]),
    );
    const expanded = new Set(frames.map((frame) => frame.cluster.id));
    const edges = buildRoutedEdges(frames, loaded, expanded, new Set(), true);
    expect(edges).toHaveLength(foreign_keys.length);
    const obstacles = frames.flatMap((frame) =>
      frame.cluster.tables.map((entry) => ({
        x: frame.position.x + (frame.positions.get(erTableKeyOf(entry))?.x ?? 0),
        y: frame.position.y + (frame.positions.get(erTableKeyOf(entry))?.y ?? 0),
        width: NODE_WIDTH,
        height: estimateNodeHeight(entry),
      })),
    );
    for (const edge of edges) {
      const points = edge.data?.points as ErPoint[];
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        expect(from.x === to.x || from.y === to.y).toBe(true);
        expect(obstacles.some((rect) => segmentHitsObstacle(from, to, rect, 0))).toBe(false);
      }
    }
    expect(buildRoutedEdges(frames, loaded, expanded, new Set(), false)).toHaveLength(
      foreign_keys.length,
    );
    const overview = buildRoutedEdges(frames, new Map(), new Set(), new Set(), false);
    expect(overview.length).toBeGreaterThan(0);
    expect(
      overview.every(
        (edge) => edge.source.startsWith("cluster:") && edge.target.startsWith("cluster:"),
      ),
    ).toBe(true);
    const selected = erTableKeyOf(tables[0]);
    const focused = buildRoutedEdges(frames, loaded, expanded, new Set([selected]), false);
    expect(focused).toHaveLength(foreign_keys.length);
    expect(focused.filter((edge) => edge.data?.highlighted)).toHaveLength(3);
  });
});
