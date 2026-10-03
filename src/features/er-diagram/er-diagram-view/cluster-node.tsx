import {
  Handle,
  type NodeProps,
  Position,
  type ReactFlowState,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { Expand, Layers3, Loader2, Network } from "lucide-react";
import { CLUSTER_DETAIL_ZOOM } from "@/features/er-diagram/er-diagram-view/constants";
import type { ClusterNodeType } from "@/features/er-diagram/er-diagram-view/types";

const selectZoom = (state: ReactFlowState) => state.transform[2];

export function ClusterNode({ id, data, width = 480, height = 360 }: NodeProps<ClusterNodeType>) {
  const zoom = useStore(selectZoom);
  const { fitView } = useReactFlow();
  const miniature = width * zoom < 180 || height * zoom < 140;
  const summaryScale = Math.min(
    1 / zoom,
    (width - 32) / (miniature ? 160 : 320),
    (height - 32) / (miniature ? 96 : 260),
  );
  const openCluster = () =>
    void fitView({
      nodes: [{ id }],
      padding: 0.1,
      minZoom: CLUSTER_DETAIL_ZOOM + 0.05,
      maxZoom: 1,
      includeHiddenNodes: true,
    });

  return (
    <div
      className="relative h-full w-full rounded-2xl border-2 border-primary/20 bg-card/70"
      data-er-cluster={data.expanded ? "expanded" : "overview"}
    >
      <Handle type="target" position={Position.Left} id="cluster-target" className="opacity-0" />
      <Handle type="source" position={Position.Right} id="cluster-source" className="opacity-0" />
      {data.expanded ? (
        <div className="flex items-center gap-3 border-b border-border/60 px-6 py-4 text-muted-foreground">
          <Layers3 className="size-5 shrink-0" />
          <span className="truncate text-lg font-semibold text-foreground" title={data.label}>
            {data.label}
          </span>
          <span className="ms-auto shrink-0 text-sm">
            {data.tableCount} Tabellen · {data.relationCount} FK
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          {miniature ? (
            <button
              type="button"
              disabled={data.loading}
              className="nodrag nopan flex w-40 flex-col items-center gap-2 rounded-lg p-2 text-center text-foreground hover:bg-primary/10"
              style={{ transform: `scale(${summaryScale})` }}
              aria-label={`Cluster ${data.label} öffnen`}
              onClick={(event) => {
                event.stopPropagation();
                openCluster();
              }}
            >
              <span className="w-full truncate text-2xl font-semibold">{data.label}</span>
              <span className="text-lg text-muted-foreground">{data.tableCount} Tabellen</span>
            </button>
          ) : (
            <div
              className="flex w-80 flex-col items-center gap-3 p-4 text-center"
              style={{ transform: `scale(${summaryScale})` }}
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {data.isolated ? <Layers3 className="size-6" /> : <Network className="size-6" />}
              </div>
              <div className="w-full min-w-0">
                <p className="truncate text-lg font-semibold text-foreground" title={data.label}>
                  {data.label}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={data.schema}>
                  {data.schema}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {data.tableCount} Tabellen · {data.relationCount} FK
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {data.preview.join(" · ")}
                {data.tableCount > data.preview.length ? " · …" : ""}
              </p>
              <button
                type="button"
                disabled={data.loading}
                className="nodrag nopan flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
                aria-label={`Cluster ${data.label} öffnen`}
                onClick={(event) => {
                  event.stopPropagation();
                  openCluster();
                }}
              >
                {data.loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Expand className="size-3.5" />
                )}
                {data.loading ? "Tabellen werden angeordnet …" : "Cluster öffnen"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
