import type { Edge } from "@xyflow/react";
import type { TableNodeType } from "@/features/er-diagram/er-diagram-view/types";
import type { ERTable, ForeignKeyInfo } from "@/lib/db";

export function buildEdges(foreignKeys: ForeignKeyInfo[]): Edge[] {
  const edgeGroups = new Map<string, ForeignKeyInfo[]>();
  for (const fk of foreignKeys) {
    const group = fk.constraint_name;
    if (!edgeGroups.has(group)) edgeGroups.set(group, []);
    edgeGroups.get(group)!.push(fk);
  }

  const edges: Edge[] = [];
  for (const [constraintName, fks] of edgeGroups) {
    const fk = fks[0];
    const sourceId = `${fk.from_schema}.${fk.from_table}`;
    const targetId = `${fk.to_schema}.${fk.to_table}`;
    const label =
      fks.length === 1
        ? `${fk.from_column} → ${fk.to_column}`
        : fks.map((f) => `${f.from_column} → ${f.to_column}`).join(", ");

    edges.push({
      id: constraintName,
      source: sourceId,
      target: targetId,
      sourceHandle: `${fk.from_column}-source`,
      targetHandle: `${fk.to_column}-target`,
      type: "smoothstep",
      animated: true,
      label,
      labelStyle: { fontSize: 10, fill: "var(--color-muted-foreground)" },
      labelBgStyle: {
        fill: "var(--color-card)",
        fillOpacity: 0.9,
      },
      style: { stroke: "var(--color-primary)", strokeWidth: 1.5 },
      markerEnd: {
        type: "arrowclosed" as const,
        color: "var(--color-primary)",
        width: 16,
        height: 16,
      },
    });
  }
  return edges;
}

export function buildNodes(
  tables: ERTable[],
  foreignKeys: ForeignKeyInfo[],
  positions: Map<string, { x: number; y: number }>,
): TableNodeType[] {
  const fkColumns = new Set<string>();
  for (const fk of foreignKeys) {
    fkColumns.add(`${fk.from_schema}.${fk.from_table}.${fk.from_column}`);
  }

  return tables.map((table) => {
    const key = `${table.schema}.${table.name}`;
    const pos = positions.get(key) ?? { x: 0, y: 0 };
    return {
      id: key,
      type: "tableNode",
      position: pos,
      data: {
        label: table.name,
        schema: table.schema,
        columns: table.columns.map((col) => ({
          name: col.name,
          dataType: col.data_type,
          isPrimaryKey: col.is_primary_key,
          isNullable: col.is_nullable,
          isForeignKey: fkColumns.has(`${table.schema}.${table.name}.${col.name}`),
        })),
      },
    };
  });
}
