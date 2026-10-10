import { TableIcon } from "lucide-react";
import {
  NODE_HEADER,
  NODE_ROW,
  NODE_WIDTH,
  QueryBuilderNode,
  type QueryBuilderNodeColumn,
} from "@/features/query-builder/query-builder-node";
import { BASE_ALIAS, JOIN_ALIAS, type JoinType, type QueryBuilderState } from "@/lib/query-builder";

const PAD = 32;
const GAP = 160;

interface QueryBuilderCanvasProps {
  state: QueryBuilderState;
  baseColumns: QueryBuilderNodeColumn[];
  joinColumns: QueryBuilderNodeColumn[];
  baseLoading: boolean;
  joinLoading: boolean;
  onToggleBase: (column: string) => void;
  onToggleJoin: (column: string) => void;
  onSelectBase: (columns: string[]) => void;
  onSelectJoin: (columns: string[]) => void;
  onRemoveJoin: () => void;
  onJoinTypeChange: (type: JoinType) => void;
}

function rowCenter(top: number, index: number) {
  return top + NODE_HEADER + NODE_ROW * Math.max(index, 0) + NODE_ROW / 2;
}

export function QueryBuilderCanvas({
  state,
  baseColumns,
  joinColumns,
  baseLoading,
  joinLoading,
  onToggleBase,
  onToggleJoin,
  onSelectBase,
  onSelectJoin,
  onRemoveJoin,
  onJoinTypeChange,
}: QueryBuilderCanvasProps) {
  if (!state.table) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <TableIcon className="size-4" />
        Keine Tabelle gewählt
      </div>
    );
  }

  const join = state.join;
  const baseTop = PAD;
  const fromIndex = join ? baseColumns.findIndex((c) => c.name === join.fromColumn) : -1;
  const toIndex = join ? joinColumns.findIndex((c) => c.name === join.toColumn) : -1;
  const joinTop = Math.max(PAD, baseTop + NODE_ROW * (fromIndex - toIndex));
  const joinLeft = PAD + NODE_WIDTH + GAP;
  const x1 = PAD + NODE_WIDTH;
  const y1 = rowCenter(baseTop, fromIndex);
  const x2 = joinLeft;
  const y2 = rowCenter(joinTop, toIndex);
  const mx = (x1 + x2) / 2;
  const height =
    Math.max(
      baseTop + NODE_HEADER + NODE_ROW * Math.max(baseColumns.length, 1),
      join ? joinTop + NODE_HEADER + NODE_ROW * Math.max(joinColumns.length, 1) : 0,
    ) + PAD;
  const width = (join ? joinLeft + NODE_WIDTH : x1) + PAD;

  return (
    <div className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]">
      <div className="relative" style={{ width, height }}>
        {join && (
          <svg
            className="pointer-events-none absolute inset-0 text-primary"
            width={width}
            height={height}
            aria-hidden
          >
            <path
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
            <circle cx={x1} cy={y1} r={3} className="fill-background" stroke="currentColor" />
            <circle cx={x2} cy={y2} r={3} fill="currentColor" />
          </svg>
        )}
        <QueryBuilderNode
          table={state.table}
          alias={join ? BASE_ALIAS : null}
          columns={baseColumns}
          selected={state.columns}
          loading={baseLoading}
          active
          x={PAD}
          y={baseTop}
          onToggle={onToggleBase}
          onSelectAll={() => onSelectBase(baseColumns.map((c) => c.name))}
          onSelectNone={() => onSelectBase([])}
        />
        {join && (
          <>
            <button
              type="button"
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-primary/60 hover:text-foreground"
              style={{ left: mx, top: (y1 + y2) / 2 }}
              title="Join-Typ wechseln"
              onClick={() => onJoinTypeChange(join.type === "INNER" ? "LEFT" : "INNER")}
            >
              {join.type.toLowerCase()}
            </button>
            <QueryBuilderNode
              table={join.table}
              alias={JOIN_ALIAS}
              columns={joinColumns}
              selected={join.columns}
              loading={joinLoading}
              x={joinLeft}
              y={joinTop}
              onToggle={onToggleJoin}
              onSelectAll={() => onSelectJoin(joinColumns.map((c) => c.name))}
              onSelectNone={() => onSelectJoin([])}
              onRemove={onRemoveJoin}
            />
          </>
        )}
      </div>
    </div>
  );
}
