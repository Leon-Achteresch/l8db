import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  ROW_HEIGHT,
} from "@/features/er-diagram/er-diagram-view/constants";
import type { ERTable, ForeignKeyInfo } from "@/lib/db";

export function estimateNodeHeight(table: ERTable): number {
  return HEADER_HEIGHT + table.columns.length * ROW_HEIGHT;
}

const elk = new ELK();

export async function computeElkLayout(
  tables: ERTable[],
  foreignKeys: ForeignKeyInfo[],
): Promise<Map<string, { x: number; y: number }>> {
  const edgeGroups = new Map<string, ForeignKeyInfo[]>();
  for (const fk of foreignKeys) {
    const group = fk.constraint_name;
    if (!edgeGroups.has(group)) edgeGroups.set(group, []);
    edgeGroups.get(group)!.push(fk);
  }

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.layered.spacing.edgeNodeBetweenLayers": "40",
      "elk.spacing.edgeNode": "40",
      "elk.spacing.edgeEdge": "20",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "PREFER_EDGES",
    },
    children: tables.map((t) => ({
      id: `${t.schema}.${t.name}`,
      width: NODE_WIDTH,
      height: estimateNodeHeight(t),
    })),
    edges: [...edgeGroups.entries()].map(([constraintName, fks]) => {
      const fk = fks[0];
      return {
        id: constraintName,
        sources: [`${fk.from_schema}.${fk.from_table}`],
        targets: [`${fk.to_schema}.${fk.to_table}`],
      };
    }),
  };

  const laid = await elk.layout(elkGraph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of laid.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return positions;
}
