import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  getNodesBounds,
  getViewportForBounds,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { toPng, toSvg } from "html-to-image";
import { jsPDF } from "jspdf";
import { FileCode, FileText, Image, KeyRound, Loader2 } from "lucide-react";

import { useActiveConnection } from "@/lib/connections";
import type { ERTable, ForeignKeyInfo } from "@/lib/db";
import { useActiveSchema } from "@/lib/db-selection";
import { useErSchemaQuery } from "@/lib/queries";

type TableNodeData = {
  label: string;
  schema: string;
  columns: {
    name: string;
    dataType: string;
    isPrimaryKey: boolean;
    isNullable: boolean;
    isForeignKey: boolean;
  }[];
};

type TableNodeType = Node<TableNodeData, "tableNode">;

const NODE_WIDTH = 240;
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 36;

function estimateNodeHeight(table: ERTable): number {
  return HEADER_HEIGHT + table.columns.length * ROW_HEIGHT;
}

function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <div className="min-w-[220px] rounded-lg border border-border bg-card shadow-md overflow-hidden">
      <div className="bg-primary px-3 py-2 text-primary-foreground font-semibold text-sm flex items-center gap-2">
        <span className="truncate">{data.label}</span>
        <span className="ml-auto text-[10px] font-normal opacity-70">{data.schema}</span>
      </div>
      <div className="divide-y divide-border">
        {data.columns.map((col) => (
          <div
            key={col.name}
            className="relative px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/50 transition-colors"
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`${col.name}-target`}
              className="!w-2 !h-2 !bg-primary !border-primary-foreground !-left-1"
            />
            <Handle
              type="source"
              position={Position.Right}
              id={`${col.name}-source`}
              className="!w-2 !h-2 !bg-primary !border-primary-foreground !-right-1"
            />
            <span className="flex items-center gap-1 font-medium min-w-0 shrink">
              {col.isPrimaryKey && <KeyRound className="size-3 text-amber-500 shrink-0" />}
              {col.isForeignKey && !col.isPrimaryKey && (
                <KeyRound className="size-3 text-blue-500 shrink-0" />
              )}
              <span className="truncate">{col.name}</span>
            </span>
            <span className="ml-auto text-muted-foreground whitespace-nowrap">
              {col.dataType}
              {!col.isNullable && <span className="ml-1 text-amber-500">*</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

const elk = new ELK();

async function computeElkLayout(
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

function buildEdges(foreignKeys: ForeignKeyInfo[]): Edge[] {
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

function buildNodes(
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

const EXPORT_SCALE = 2;
const EXPORT_PADDING = 40;

async function getFlowElement(): Promise<HTMLElement> {
  const el = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!el) throw new Error("React Flow viewport not found");
  return el;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function ExportButtons({ nodes }: { nodes: TableNodeType[] }) {
  const { getNodes } = useReactFlow();
  const [exporting, setExporting] = useState(false);

  const doExport = useCallback(
    async (format: "png" | "svg" | "pdf") => {
      if (exporting) return;
      setExporting(true);

      try {
        const currentNodes = getNodes();
        if (currentNodes.length === 0) return;

        const bounds = getNodesBounds(currentNodes);
        const w = bounds.width + EXPORT_PADDING * 2;
        const h = bounds.height + EXPORT_PADDING * 2;

        const viewport = getViewportForBounds(bounds, w, h, 0.1, 2, EXPORT_PADDING);

        const el = await getFlowElement();

        const extensions: Record<string, string> = {
          png: "png",
          svg: "svg",
          pdf: "pdf",
        };

        const filePath = await save({
          title: `ER-Diagramm als ${format.toUpperCase()} speichern`,
          defaultPath: `er-diagramm.${extensions[format]}`,
          filters: [
            {
              name: format.toUpperCase(),
              extensions: [extensions[format]],
            },
          ],
        });
        if (!filePath) return;

        if (format === "png") {
          const dataUrl = await toPng(el, {
            width: w * EXPORT_SCALE,
            height: h * EXPORT_SCALE,
            style: {
              width: `${w}px`,
              height: `${h}px`,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            },
            pixelRatio: EXPORT_SCALE,
          });
          await writeFile(filePath, dataUrlToUint8Array(dataUrl));
        }

        if (format === "svg") {
          const svgString = await toSvg(el, {
            width: w * EXPORT_SCALE,
            height: h * EXPORT_SCALE,
            style: {
              width: `${w}px`,
              height: `${h}px`,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            },
          });
          await writeTextFile(filePath, svgString);
        }

        if (format === "pdf") {
          const dataUrl = await toPng(el, {
            width: w * EXPORT_SCALE,
            height: h * EXPORT_SCALE,
            style: {
              width: `${w}px`,
              height: `${h}px`,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            },
            pixelRatio: EXPORT_SCALE,
          });

          const orientation = w > h ? "landscape" : "portrait";
          const pdf = new jsPDF({
            orientation,
            unit: "px",
            format: [w, h],
          });
          pdf.addImage(dataUrl, "PNG", 0, 0, w, h);
          const pdfBytes = pdf.output("arraybuffer");
          await writeFile(filePath, new Uint8Array(pdfBytes));
        }
      } finally {
        setExporting(false);
      }
    },
    [exporting, getNodes],
  );

  return (
    <div className="rounded-md bg-card border border-border shadow-sm flex items-center">
      <button
        type="button"
        onClick={() => doExport("png")}
        disabled={exporting || nodes.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:pointer-events-none rounded-l-md"
        title="Als PNG exportieren"
      >
        <Image className="size-3.5" />
        PNG
      </button>
      <div className="w-px h-5 bg-border" />
      <button
        type="button"
        onClick={() => doExport("svg")}
        disabled={exporting || nodes.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Als SVG exportieren"
      >
        <FileCode className="size-3.5" />
        SVG
      </button>
      <div className="w-px h-5 bg-border" />
      <button
        type="button"
        onClick={() => doExport("pdf")}
        disabled={exporting || nodes.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:pointer-events-none rounded-r-md"
        title="Als PDF exportieren"
      >
        <FileText className="size-3.5" />
        PDF
      </button>
    </div>
  );
}

function ERDiagramInner() {
  const connection = useActiveConnection();
  const activeSchema = useActiveSchema();
  const { data: erSchema, isLoading, error } = useErSchemaQuery(activeSchema);

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const layoutVersionRef = useRef(0);

  const builtEdges = useMemo(() => {
    if (!erSchema) return [];
    return buildEdges(erSchema.foreign_keys);
  }, [erSchema]);

  useEffect(() => {
    if (!erSchema || erSchema.tables.length === 0) {
      setNodes([]);
      setEdges([]);
      setLayoutReady(false);
      return;
    }

    const version = ++layoutVersionRef.current;

    setLayoutReady(false);
    computeElkLayout(erSchema.tables, erSchema.foreign_keys).then((positions) => {
      if (layoutVersionRef.current !== version) return;
      const layoutedNodes = buildNodes(erSchema.tables, erSchema.foreign_keys, positions);
      setNodes(layoutedNodes);
      setEdges(builtEdges);
      setLayoutReady(true);
    });
  }, [erSchema, builtEdges, setNodes, setEdges]);

  if (!connection) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Verbinde dich zuerst mit einer Datenbank.</p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-destructive">
          {error instanceof Error ? error.message : "Fehler beim Laden"}
        </p>
      </main>
    );
  }

  if (!erSchema || erSchema.tables.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Keine Tabellen im Schema "{activeSchema}" gefunden.</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col h-full">
      <div className="flex-1 w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          key={layoutReady ? "ready" : "loading"}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeColor="var(--color-border)"
            nodeColor="var(--color-card)"
            maskColor="rgba(0,0,0,0.1)"
          />
          <Panel position="top-left" className="flex flex-col gap-1">
            <div className="rounded-md bg-card border border-border px-3 py-2 text-xs text-muted-foreground shadow-sm">
              <span className="font-medium text-foreground">{erSchema.tables.length}</span>{" "}
              Tabellen,{" "}
              <span className="font-medium text-foreground">{erSchema.foreign_keys.length}</span>{" "}
              Foreign Keys
            </div>
            <ExportButtons nodes={nodes} />
            <div className="rounded-md bg-card border border-border px-3 py-1.5 text-[10px] text-muted-foreground shadow-sm flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <KeyRound className="size-3 text-amber-500" /> Primary Key
              </div>
              <div className="flex items-center gap-1.5">
                <KeyRound className="size-3 text-blue-500" /> Foreign Key
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-amber-500 font-bold">*</span> NOT NULL
              </div>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </main>
  );
}

export function ErDiagramView() {
  return (
    <ReactFlowProvider>
      <ERDiagramInner />
    </ReactFlowProvider>
  );
}
