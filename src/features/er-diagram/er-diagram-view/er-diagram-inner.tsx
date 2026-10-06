import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CLUSTER_DETAIL_ZOOM } from "@/features/er-diagram/er-diagram-view/constants";
import { edgeTypes } from "@/features/er-diagram/er-diagram-view/edge-types";
import { ErClusterPanel } from "@/features/er-diagram/er-diagram-view/er-cluster-panel";
import { ErFullDetailContext } from "@/features/er-diagram/er-diagram-view/er-detail-context";
import { ErFocusPanel } from "@/features/er-diagram/er-diagram-view/er-focus-panel";
import { ErViewportWatcher } from "@/features/er-diagram/er-diagram-view/er-viewport-watcher";
import { ExportButtons } from "@/features/er-diagram/er-diagram-view/export-buttons";
import { nodeTypes } from "@/features/er-diagram/er-diagram-view/node-types";
import { TextExportMenu } from "@/features/er-diagram/er-diagram-view/text-export-menu";
import type { ErNodeType } from "@/features/er-diagram/er-diagram-view/types";
import { useClusterGraph } from "@/features/er-diagram/er-diagram-view/use-cluster-graph";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
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
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const { data: fullSchema, isLoading, error } = useErSchemaQuery(activeSchema);
  const navigate = useNavigate();
  const { fitView } = useReactFlow<ErNodeType>();
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

  const [exporting, setExporting] = useState(false);
  const interacted = useRef(false);
  const { nodes, edges, clusters, onNodesChange, onVisibilityChange, prepareExport } =
    useClusterGraph(erSchema, exporting);
  const showOverview = useCallback(() => {
    void fitView({
      nodes: clusters.map((cluster) => ({ id: cluster.id })),
      padding: 0.2,
      minZoom: 0.02,
      maxZoom: CLUSTER_DETAIL_ZOOM - 0.05,
      includeHiddenNodes: true,
    });
  }, [clusters, fitView]);

  useEffect(() => {
    interacted.current = false;
    if (clusters.length === 0) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!interacted.current) showOverview();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [clusters, showOverview]);

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
    <main
      className="flex min-h-0 flex-1 flex-col h-full"
      onPointerDownCapture={() => {
        interacted.current = true;
      }}
      onWheelCapture={() => {
        interacted.current = true;
      }}
      onKeyDownCapture={() => {
        interacted.current = true;
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background px-3 py-2">
        <ErClusterPanel
          clusterCount={clusters.length}
          tableCount={erSchema.tables.length}
          foreignKeyCount={erSchema.foreign_keys.length}
          onOverview={showOverview}
        />
        <ExportButtons
          nodes={nodes}
          exporting={exporting}
          setExporting={setExporting}
          prepareExport={prepareExport}
        />
        <TextExportMenu schema={erSchema} />
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="max-w-64 truncate rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
            >
              {focus ? `${focus.table} · Tiefe ${focus.depth}` : "Fokus & Legende"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <ErFocusPanel
              tables={fullSchema.tables}
              focusKey={focusKey}
              depth={focus?.depth ?? 1}
              onFocusChange={(key) => setFocus(key, focus?.depth ?? 1)}
              onDepthChange={(depth) => setFocus(focusKey, depth)}
              onClear={() => setFocus(null, 1)}
            />
            <div className="px-3 py-2 text-[10px] text-muted-foreground flex flex-col gap-0.5">
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
          </PopoverContent>
        </Popover>
      </div>
      <div className="relative min-h-0 flex-1 w-full">
        <ErFullDetailContext value={exporting}>
          <ReactFlow<ErNodeType>
            nodes={nodes}
            edges={edges}
            onlyRenderVisibleElements={!exporting}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 0.1 }}
            minZoom={0.02}
            maxZoom={2}
            panOnScroll
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            nodesDraggable={false}
            multiSelectionKeyCode={null}
            deleteKeyCode={null}
            onNodeDoubleClick={(_, node) => {
              if (node.type === "clusterNode")
                void fitView({
                  nodes: [{ id: node.id }],
                  padding: 0.1,
                  minZoom: CLUSTER_DETAIL_ZOOM + 0.05,
                  maxZoom: 1,
                  includeHiddenNodes: true,
                });
            }}
            onNodeClick={(_, node) => {
              if (node.type === "clusterNode" && !node.data.expanded)
                void fitView({
                  nodes: [{ id: node.id }],
                  padding: 0.1,
                  minZoom: CLUSTER_DETAIL_ZOOM + 0.05,
                  maxZoom: 1,
                  includeHiddenNodes: true,
                });
            }}
            key={`${connection.id}:${activeDatabase}:${activeSchema}:${focusKey}:${focus?.depth}`}
          >
            <ErViewportWatcher onChange={onVisibilityChange} />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
            <MiniMap
              nodeStrokeColor="var(--color-border)"
              nodeColor="var(--color-card)"
              maskColor="rgba(0,0,0,0.1)"
            />
          </ReactFlow>
        </ErFullDetailContext>
      </div>
    </main>
  );
}
