import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEdges, buildNodes } from "@/features/er-diagram/er-diagram-view/build-graph";
import { NODE_WIDTH } from "@/features/er-diagram/er-diagram-view/constants";
import { ErFocusPanel } from "@/features/er-diagram/er-diagram-view/er-focus-panel";
import { ExportButtons } from "@/features/er-diagram/er-diagram-view/export-buttons";
import { computeElkLayout } from "@/features/er-diagram/er-diagram-view/layout";
import { nodeTypes } from "@/features/er-diagram/er-diagram-view/node-types";
import type { TableNodeType } from "@/features/er-diagram/er-diagram-view/types";
import { useActiveConnection } from "@/lib/connections";
import { useActiveSchema } from "@/lib/db-selection";
import {
  type ErFocusDepth,
  erTableKey,
  erTableKeyOf,
  filterErSchema,
  parseErFocusDepth,
} from "@/lib/er-focus";
import { useErSchemaQuery } from "@/lib/queries";

export function ERDiagramInner() {
  const connection = useActiveConnection();
  const activeSchema = useActiveSchema();
  const { data: fullSchema, isLoading, error } = useErSchemaQuery(activeSchema);
  const navigate = useNavigate();
  const search = useSearch({ from: "/_app/_workspace/er-diagram", shouldThrow: false });

  const focus = useMemo(() => {
    if (!search?.focusSchema || !search?.focusTable) return null;
    return {
      schema: search.focusSchema,
      table: search.focusTable,
      depth: parseErFocusDepth(search.depth),
    };
  }, [search?.focusSchema, search?.focusTable, search?.depth]);

  const focusKey = focus ? erTableKey(focus.schema, focus.table) : null;
  const focusMissing = Boolean(
    focus && fullSchema && !fullSchema.tables.some((table) => erTableKeyOf(table) === focusKey),
  );

  const setFocus = useCallback(
    (key: string | null, depth: ErFocusDepth) => {
      if (!key) {
        void navigate({ to: "/er-diagram", search: {} });
        return;
      }
      const separator = key.indexOf(".");
      void navigate({
        to: "/er-diagram",
        search: {
          focusSchema: key.slice(0, separator),
          focusTable: key.slice(separator + 1),
          depth,
        },
      });
    },
    [navigate],
  );

  const erSchema = useMemo(
    () => (fullSchema ? filterErSchema(fullSchema, focus) : fullSchema),
    [fullSchema, focus],
  );

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
    const tables = erSchema.tables;
    const foreignKeys = erSchema.foreign_keys;
    const applyPositions = (positions: Map<string, { x: number; y: number }>) => {
      if (layoutVersionRef.current !== version) return;
      setNodes(buildNodes(tables, foreignKeys, positions));
      setEdges(builtEdges);
      setLayoutReady(true);
    };
    computeElkLayout(tables, foreignKeys).then(applyPositions, () => {
      const columns = 4;
      applyPositions(
        new Map(
          tables.map((table, index) => [
            `${table.schema}.${table.name}`,
            {
              x: (index % columns) * (NODE_WIDTH + 60),
              y: Math.floor(index / columns) * 420,
            },
          ]),
        ),
      );
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

  if (!fullSchema || fullSchema.tables.length === 0 || !erSchema) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Keine Tabellen im Schema "{activeSchema}" gefunden.</p>
      </main>
    );
  }

  if (erSchema.tables.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">
          {focusMissing
            ? `Tabelle "${focusKey}" ist im Schema "${activeSchema}" nicht vorhanden.`
            : "Kein Ausschnitt für den gewählten Fokus."}
        </p>
        <button
          type="button"
          onClick={() => setFocus(null, 1)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          Fokus aufheben
        </button>
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
            <ErFocusPanel
              tables={fullSchema.tables}
              focusKey={focusKey}
              depth={focus?.depth ?? 1}
              onFocusChange={(key) => setFocus(key, focus?.depth ?? 1)}
              onDepthChange={(depth) => setFocus(focusKey, depth)}
              onClear={() => setFocus(null, 1)}
            />
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
