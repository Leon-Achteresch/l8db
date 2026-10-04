import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Position,
} from "@xyflow/react";
import { PlusIcon, XIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { StepAddMenu } from "./step-add-menu";
import { useStepGraph } from "./step-graph-context";
import { GOTO_COLOR, type StepFlowEdge } from "./step-graph-types";

function stroke(data: StepFlowEdge["data"], selected: boolean): CSSProperties {
  const failure = data?.handle === "failure";
  const jump = data?.role === "goto";
  const color = data?.dropping
    ? "var(--color-primary)"
    : failure
      ? "var(--color-destructive)"
      : jump
        ? GOTO_COLOR
        : "color-mix(in oklab, var(--color-muted-foreground) 55%, transparent)";
  return {
    stroke: color,
    strokeWidth: selected || data?.dropping ? 2 : 1.25,
    strokeDasharray: failure ? "4 3" : undefined,
  };
}

function roundedPath(points: { x: number; y: number }[], radius = 8): string {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const into = Math.min(radius, Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2);
    const out = Math.min(radius, Math.hypot(next.x - corner.x, next.y - corner.y) / 2);
    const a = {
      x: corner.x - Math.sign(corner.x - previous.x) * into,
      y: corner.y - Math.sign(corner.y - previous.y) * into,
    };
    const b = {
      x: corner.x + Math.sign(next.x - corner.x) * out,
      y: corner.y + Math.sign(next.y - corner.y) * out,
    };
    path += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
  }
  const last = points.at(-1) ?? points[0];
  return `${path} L ${last.x} ${last.y}`;
}

export function StepGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected = false,
  data,
}: EdgeProps<StepFlowEdge>) {
  const { insert, disconnect } = useStepGraph();
  const right = sourcePosition === Position.Right;
  const lane = data?.lane ?? null;
  const [smooth, smoothX, smoothY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
    offset: 18,
  });
  const entry = targetY - 16;
  const path =
    lane === null
      ? smooth
      : roundedPath([
          { x: sourceX, y: sourceY },
          ...(right ? [] : [{ x: sourceX, y: sourceY + 12 }]),
          { x: lane, y: right ? sourceY : sourceY + 12 },
          { x: lane, y: entry },
          { x: targetX, y: entry },
          { x: targetX, y: targetY },
        ]);
  const midX = lane ?? smoothX;
  const midY = lane === null ? smoothY : (sourceY + entry) / 2;
  const label = data?.label;
  const where = data?.insert;
  const failure = data?.handle === "failure";

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={stroke(data, selected)} />
      <EdgeLabelRenderer>
        {label && (
          <span
            className={cn(
              "nodrag nopan pointer-events-none absolute rounded bg-background/90 px-1 text-[11px] leading-4 font-medium",
              failure
                ? "text-red-700 dark:text-red-300"
                : data?.role === "goto"
                  ? "text-sky-700 dark:text-sky-300"
                  : "text-muted-foreground",
            )}
            style={{
              transform: right
                ? `translate(${sourceX + 8}px, ${sourceY - 18}px)`
                : data?.handle === "yes"
                  ? `translate(-100%, 0) translate(${sourceX - 4}px, ${sourceY + 2}px)`
                  : `translate(${sourceX + 4}px, ${sourceY + 2}px)`,
            }}
          >
            {label}
          </span>
        )}
        {selected && data?.deletable ? (
          <button
            type="button"
            aria-label={`Verbindung „${label ?? "Ablauf"}“ entfernen`}
            title="Entfernen (Entf)"
            onClick={() => disconnect(id)}
            className="nodrag nopan pointer-events-auto absolute grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-xs hover:text-destructive"
            style={{ transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)` }}
          >
            <XIcon className="size-3" />
          </button>
        ) : (
          where && (
            <StepAddMenu onPick={(type) => insert(where, type)} align="center">
              <button
                type="button"
                data-insert-edge={id}
                data-insert-index={`${where.parentId ?? "root"}:${where.index}`}
                aria-label="Schritt hier einfügen"
                title="Schritt hier einfügen"
                className={cn(
                  "nodrag nopan pointer-events-auto absolute grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-xs transition-[opacity,scale,color] duration-150 ease-out outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95",
                  data?.dropping
                    ? "scale-125 border-primary text-primary opacity-100"
                    : "opacity-70 hover:opacity-100",
                )}
                style={{ transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)` }}
              >
                <PlusIcon className="size-3" />
              </button>
            </StepAddMenu>
          )
        )}
      </EdgeLabelRenderer>
    </>
  );
}
