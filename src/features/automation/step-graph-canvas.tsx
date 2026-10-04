import {
  Background,
  BackgroundVariant,
  type Connection,
  MarkerType,
  MiniMap,
  type NodeChange,
  Panel,
  ReactFlow,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LoaderCircleIcon, LocateFixedIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  buildStepGraph,
  flowFor,
  type GraphHandle,
  type GraphInsert,
  handlesFor,
  moveToInsert,
  resetConnection,
  resolveConnection,
  type StepGraphNode,
} from "@/lib/automation/step-graph";
import { summarizeStep } from "@/lib/automation/step-summary";
import { flattenSteps, moveStep } from "@/lib/automation/step-tree";
import { toast } from "@/lib/automation/toast";
import type {
  ActionType,
  RunStatus,
  Step,
  StepRun,
  Task,
  ValidationIssue,
} from "@/lib/db/automation";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { type StepGraphActions, StepGraphContext } from "./step-graph-context";
import { edgeLanes, type GraphBox, layoutStepGraph, startLines } from "./step-graph-layout";
import { stepEdgeTypes, stepNodeTypes } from "./step-graph-node-types";
import { GOTO_COLOR, LOOP_HEADER, type StepFlowEdge, type StepFlowNode } from "./step-graph-types";

export interface StepGraphProps {
  task: Task;
  selectedId: string | null;
  issues: ValidationIssue[];
  runSteps: StepRun[] | null;
  onSelect: (id: string | null) => void;
  onChange: (steps: Step[]) => void;
  onInsert: (insert: GraphInsert, type: ActionType) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  connectionName: (ref: string) => string;
  taskName: (ref: string) => string;
  taskNames: Record<string, string>;
}

const MIN_ZOOM = 0.92;
const EDGE_SPACE = 16;
const PEEK_SPACE = 64;
const CONTROLS_GUTTER = 56;
const SMOOTH_OUT = (t: number) => 1 - (1 - t) ** 5;

const THEME = {
  "--xy-background-color": "transparent",
  "--xy-background-pattern-color": "color-mix(in oklab, var(--color-foreground) 13%, transparent)",
  "--xy-minimap-background-color": "var(--color-card)",
  "--xy-minimap-mask-background-color":
    "color-mix(in oklab, var(--color-background) 70%, transparent)",
  "--xy-minimap-mask-stroke-color": "var(--color-border)",
  "--xy-minimap-node-background-color":
    "color-mix(in oklab, var(--color-muted-foreground) 55%, transparent)",
  "--xy-minimap-node-stroke-color": "transparent",
  "--xy-connectionline-stroke": "var(--color-primary)",
  "--xy-connectionline-stroke-width": "1.5",
  overflow: "clip",
} as CSSProperties;

function markerColor(handle: GraphHandle, role: string): string {
  if (handle === "failure") return "var(--color-destructive)";
  if (role === "goto") return GOTO_COLOR;
  return "color-mix(in oklab, var(--color-muted-foreground) 55%, transparent)";
}

function structureKey(
  nodes: StepGraphNode[],
  lines: number,
  edges: { id: string; target: string; role: string }[],
) {
  return JSON.stringify([
    lines,
    nodes.map((node) => [node.id, node.parentId, node.kind]),
    edges.filter((edge) => edge.role !== "goto").map((edge) => [edge.id, edge.target]),
  ]);
}

function handlePoint(box: GraphBox, handle: GraphHandle | "top") {
  if (handle === "top") return { x: box.x + box.width / 2, y: box.y };
  if (handle === "failure") return { x: box.x + box.width, y: box.y + box.height / 2 };
  const share = handle === "yes" ? 0.32 : handle === "no" ? 0.68 : 0.5;
  return { x: box.x + box.width * share, y: box.y + box.height };
}

export function StepGraphCanvas({
  task,
  selectedId,
  issues,
  runSteps,
  onSelect,
  onChange,
  onInsert,
  onRemove,
  onDuplicate,
  connectionName,
  taskName,
  taskNames,
}: StepGraphProps) {
  const steps = task.steps;
  const reduce = useReducedMotion();
  const flow = useReactFlow<StepFlowNode, StepFlowEdge>();
  const { ref, width, height } = useElementSize<HTMLElement>();
  const graph = useMemo(() => buildStepGraph(steps), [steps]);
  const flat = useMemo(() => flattenSteps(steps), [steps]);
  const scheduleCount = task.schedules.filter((schedule) => schedule.enabled).length;
  const lines = startLines(scheduleCount);
  const key = structureKey(graph.nodes, lines, graph.edges);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const [boxes, setBoxes] = useState<Map<string, GraphBox> | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropEdge, setDropEdge] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const placed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    layoutStepGraph(graphRef.current, lines)
      .then((laid) => {
        if (!cancelled) {
          setBoxes(laid);
          setLayoutError(null);
        }
      })
      .catch((reason) => {
        if (!cancelled) setLayoutError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [key, lines]);

  const absolute = useMemo(() => {
    const map = new Map<string, GraphBox>();
    if (!boxes) return map;
    const parents = new Map(graph.nodes.map((node) => [node.id, node.parentId]));
    for (const [id, box] of boxes) {
      let x = box.x;
      let y = box.y;
      let parent = parents.get(id);
      while (parent) {
        const outer = boxes.get(parent);
        x += outer?.x ?? 0;
        y += outer?.y ?? 0;
        parent = parents.get(parent);
      }
      map.set(id, { ...box, x, y });
    }
    return map;
  }, [boxes, graph.nodes]);

  const counts = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number }>();
    for (const issue of issues) {
      if (!issue.stepId) continue;
      const entry = map.get(issue.stepId) ?? { errors: 0, warnings: 0 };
      if (issue.severity === "error") entry.errors += 1;
      else entry.warnings += 1;
      map.set(issue.stepId, entry);
    }
    return map;
  }, [issues]);

  const statuses = useMemo(() => {
    const map = new Map<string, RunStatus>();
    for (const run of runSteps ?? []) map.set(run.stepId, run.status);
    return map;
  }, [runSteps]);

  const rovingId =
    focusId && flat.some((entry) => entry.step.id === focusId)
      ? focusId
      : (selectedId ?? flat[0]?.step.id ?? null);

  const nodes = useMemo<StepFlowNode[]>(() => {
    if (!boxes) return [];
    const result: StepFlowNode[] = [];
    for (const node of graph.nodes) {
      const box = boxes.get(node.id);
      if (!box) continue;
      const position = drag?.id === node.id ? { x: drag.x, y: drag.y } : { x: box.x, y: box.y };
      const common = {
        id: node.id,
        position,
        parentId: node.parentId ?? undefined,
        width: box.width,
        height: box.height,
        deletable: false,
        selectable: false,
        connectable: false,
        draggable: false,
      };
      if (node.kind === "step" || node.kind === "loop") {
        const step = node.step as Step;
        const count = counts.get(step.id);
        const data = {
          step,
          number: node.number ?? "",
          summary: summarizeStep(step, connectionName, taskName),
          selected: step.id === selectedId,
          focusable: step.id === rovingId,
          errors: count?.errors ?? 0,
          warnings: count?.warnings ?? 0,
          status: statuses.get(step.id) ?? null,
          fresh: seen.current !== null && !seen.current.has(step.id),
        };
        result.push(
          node.kind === "loop"
            ? {
                ...common,
                type: "loop",
                data,
                draggable: true,
                connectable: true,
              }
            : { ...common, type: "step", data, draggable: true, connectable: true },
        );
      } else if (node.kind === "start") {
        result.push({ ...common, type: "start", data: { schedules: task.schedules, taskNames } });
      } else if (node.kind === "add") {
        result.push({ ...common, type: "add", data: { parentId: node.parentId ?? "" } });
      } else {
        const parent = node.parentId ? flat.find((entry) => entry.step.id === node.parentId) : null;
        result.push({
          ...common,
          type: "terminal",
          connectable: node.kind !== "entry",
          data: {
            kind: node.kind,
            nested: Boolean(node.parentId),
            item: parent?.step.action.type === "loop" ? parent.step.action.item : "",
          },
        });
      }
    }
    return result;
  }, [
    boxes,
    graph.nodes,
    drag,
    counts,
    connectionName,
    taskName,
    selectedId,
    rovingId,
    statuses,
    task.schedules,
    taskNames,
    flat,
  ]);

  useEffect(() => {
    if (!boxes) return;
    seen.current = new Set(flat.filter((entry) => boxes.has(entry.step.id)).map((e) => e.step.id));
  }, [boxes, flat]);

  const parents = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.parentId])),
    [graph.nodes],
  );

  const lanes = useMemo(() => edgeLanes(graph, absolute), [graph, absolute]);

  const edges = useMemo<StepFlowEdge[]>(
    () =>
      graph.edges
        .filter((edge) => boxes?.has(edge.source) && boxes.has(edge.target))
        .map((edge) => ({
          id: edge.id,
          type: "flow",
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.handle,
          selected: edge.id === selectedEdge,
          selectable: edge.deletable,
          focusable: edge.deletable,
          deletable: false,
          zIndex: parents.get(edge.source) ? 1 : 0,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: markerColor(edge.handle, edge.role),
          },
          data: {
            handle: edge.handle,
            role: edge.role,
            label: edge.label,
            insert: edge.insert,
            deletable: edge.deletable,
            dropping: edge.id === dropEdge,
            lane: lanes.get(edge.id) ?? null,
          },
        })),
    [graph.edges, boxes, selectedEdge, dropEdge, parents, lanes],
  );

  const reveal = useCallback(
    (viewport: Viewport, id: string): Viewport => {
      const box = absolute.get(id);
      if (!box || !width || !height) return viewport;
      const { x, y, zoom } = viewport;
      const margin = 24;
      const left = box.x * zoom + x;
      const top = box.y * zoom + y;
      const right = left + Math.min(box.width, 320) * zoom;
      const bottom = top + Math.min(box.height, LOOP_HEADER) * zoom;
      const dx =
        left < CONTROLS_GUTTER || right > width - margin
          ? Math.max(CONTROLS_GUTTER - left, (width - left - right) / 2)
          : 0;
      const dy =
        top < margin || bottom > height - PEEK_SPACE
          ? Math.max(margin - top, (height - top - bottom) / 2)
          : 0;
      return { x: x + dx, y: y + dy, zoom };
    },
    [absolute, width, height],
  );

  const ensureVisible = useCallback(
    (id: string) => {
      const current = flow.getViewport();
      const next = reveal(current, id);
      if (next.x !== current.x || next.y !== current.y) void flow.setViewport(next);
    },
    [flow, reveal],
  );

  const bounds = useMemo(() => {
    const all = [...absolute.values()];
    if (!all.length) return null;
    const minX = Math.min(...all.map((box) => box.x));
    const minY = Math.min(...all.map((box) => box.y));
    return {
      minX,
      minY,
      width: Math.max(...all.map((box) => box.x + box.width)) - minX,
      height: Math.max(...all.map((box) => box.y + box.height)) - minY,
    };
  }, [absolute]);

  const fits =
    bounds !== null &&
    bounds.width * MIN_ZOOM <= width - CONTROLS_GUTTER - EDGE_SPACE &&
    bounds.height * MIN_ZOOM <= height - 2 * EDGE_SPACE;

  const home = useCallback((): Viewport | null => {
    if (!bounds || !width || !height) return null;
    const room = width - CONTROLS_GUTTER - EDGE_SPACE;
    const fit = Math.min(room / bounds.width, (height - 2 * EDGE_SPACE) / bounds.height);
    const zoom = fit >= MIN_ZOOM ? Math.min(1, fit) : 1;
    const x =
      bounds.width * zoom <= room
        ? CONTROLS_GUTTER + (room - bounds.width * zoom) / 2 - bounds.minX * zoom
        : CONTROLS_GUTTER - bounds.minX * zoom;
    const y =
      bounds.height * zoom <= height - 2 * EDGE_SPACE
        ? (height - bounds.height * zoom) / 2 - bounds.minY * zoom
        : EDGE_SPACE - bounds.minY * zoom;
    return { x, y, zoom };
  }, [bounds, width, height]);

  const focusStep = useCallback(
    (id: string) => {
      setFocusId(id);
      ensureVisible(id);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(`[data-graph-step="${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: true }),
      );
    },
    [ensureVisible],
  );

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const lastWidth = useRef(0);
  useEffect(() => {
    const previous = lastWidth.current;
    lastWidth.current = width;
    if (!placed.current || !previous || !width || previous === width) return;
    const viewport = flow.getViewport();
    const shifted = { ...viewport, x: viewport.x + (width - previous) / 2 };
    const id = selectedRef.current;
    void flow.setViewport(shifted);
    if (id)
      void flow.setViewport(reveal(shifted, id), {
        duration: reduce ? 0 : 250,
        ease: SMOOTH_OUT,
      });
  }, [width, flow, reveal, reduce]);

  useEffect(() => {
    if (selectedId) ensureVisible(selectedId);
  }, [selectedId, ensureVisible]);

  useEffect(() => {
    if (placed.current || !boxes) return;
    const viewport = home();
    if (!viewport) return;
    placed.current = true;
    void flow.setViewport(viewport);
  }, [boxes, home, flow]);

  const keyDown = useCallback(
    (id: string, event: KeyboardEvent<HTMLElement>) => {
      const position = flat.findIndex((entry) => entry.step.id === id);
      const entry = flat[position];
      if (!entry) return;
      const mod = event.metaKey || event.ctrlKey;
      const go = (target: string | null | undefined) => {
        event.preventDefault();
        if (target) focusStep(target);
      };
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const to = entry.index + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= entry.siblings.length) return;
        onChange(moveStep(steps, entry.parentId, entry.index, to));
        setAnnouncement(
          `„${entry.step.name}“ ist jetzt Schritt ${to + 1} von ${entry.siblings.length}.`,
        );
        focusStep(id);
      } else if (event.key === "ArrowDown") go(flat[position + 1]?.step.id);
      else if (event.key === "ArrowUp") go(flat[position - 1]?.step.id);
      else if (event.key === "Home") go(flat[0]?.step.id);
      else if (event.key === "End") go(flat.at(-1)?.step.id);
      else if (event.key === "ArrowRight") {
        if (entry.step.action.type === "loop") go(entry.step.action.steps[0]?.id);
        else {
          const jump = handlesFor(entry.step)
            .map((handle) => flowFor(entry.step, handle))
            .find((target) => target.type === "goto");
          go(jump?.type === "goto" ? jump.stepId : null);
        }
      } else if (event.key === "ArrowLeft") go(entry.parentId);
      else if (event.key === "Escape") {
        event.preventDefault();
        onSelect(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && !mod) {
        event.preventDefault();
        const next = flat[position + 1] ?? flat[position - 1];
        onRemove(id);
        if (next) focusStep(next.step.id);
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        onDuplicate(id);
      }
    },
    [flat, focusStep, onChange, onSelect, onRemove, onDuplicate, steps],
  );

  const disconnect = useCallback(
    (edgeId: string) => {
      const edge = graph.edges.find((entry) => entry.id === edgeId);
      if (!edge?.deletable) return;
      onChange(resetConnection(steps, edge.source, edge.handle));
      setSelectedEdge(null);
      setAnnouncement("Verbindung entfernt.");
    },
    [graph.edges, onChange, steps],
  );

  const actions = useMemo<StepGraphActions>(
    () => ({
      select: (id) => {
        setFocusId(id);
        setSelectedEdge(null);
        onSelect(id);
      },
      focus: (id) => {
        const pane = ref.current?.querySelector<HTMLElement>(".react-flow");
        if (pane) {
          pane.scrollTop = 0;
          pane.scrollLeft = 0;
        }
        ensureVisible(id);
      },
      keyDown,
      insert: onInsert,
      disconnect,
    }),
    [keyDown, onInsert, disconnect, onSelect, ensureVisible, ref],
  );

  const connect = useCallback(
    (connection: Connection) => {
      const result = resolveConnection(
        steps,
        connection.source,
        connection.sourceHandle as GraphHandle,
        connection.target,
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onChange(result.steps);
      setAnnouncement("Sprungziel gesetzt.");
    },
    [steps, onChange],
  );

  const findDropEdge = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
      const inside = (id: string | null | undefined): boolean => {
        let cursor = id;
        while (cursor) {
          if (cursor === nodeId) return true;
          cursor = parents.get(cursor) ?? null;
        }
        return false;
      };
      let best: { id: string; distance: number } | null = null;
      for (const edge of graph.edges) {
        if (!edge.insert || inside(edge.source) || inside(edge.target)) continue;
        const source = absolute.get(edge.source);
        const target = absolute.get(edge.target);
        if (!source || !target) continue;
        const from = handlePoint(source, edge.handle);
        const to = handlePoint(target, "top");
        const distance = Math.hypot((from.x + to.x) / 2 - point.x, (from.y + to.y) / 2 - point.y);
        if (distance < 40 && (!best || distance < best.distance)) best = { id: edge.id, distance };
      }
      return best?.id ?? null;
    },
    [flow, graph.edges, absolute, parents],
  );

  const onNodesChange = useCallback((changes: NodeChange<StepFlowNode>[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position && change.dragging)
        setDrag({ id: change.id, x: change.position.x, y: change.position.y });
    }
  }, []);

  if (layoutError) {
    return (
      <p className="p-4 text-xs text-pretty text-destructive">
        Layout fehlgeschlagen: {layoutError}. Die Ansicht „Liste“ zeigt alle Schritte.
      </p>
    );
  }

  return (
    <StepGraphContext.Provider value={actions}>
      <section
        ref={ref}
        data-testid="automation-step-graph"
        aria-label="Ablauf als Graph. Pfeiltasten wechseln den Schritt, Eingabe öffnet ihn, Alt mit Pfeil verschiebt ihn."
        className="relative min-h-0 flex-1"
        onKeyDown={(event) => {
          if (selectedEdge && (event.key === "Delete" || event.key === "Backspace")) {
            event.preventDefault();
            disconnect(selectedEdge);
          }
        }}
      >
        {!boxes && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground animate-in fade-in-0 fill-mode-backwards delay-300 duration-150">
            <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
            Layout wird berechnet …
          </div>
        )}
        <ReactFlow<StepFlowNode, StepFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={stepNodeTypes}
          edgeTypes={stepEdgeTypes}
          onNodesChange={onNodesChange}
          onNodeDrag={(event, node) => {
            const point = "touches" in event ? event.touches[0] : event;
            if (point) setDropEdge(findDropEdge(node.id, point.clientX, point.clientY));
          }}
          onNodeDragStop={(_, node) => {
            const edge = graph.edges.find((entry) => entry.id === dropEdge);
            setDrag(null);
            setDropEdge(null);
            if (!edge?.insert) return;
            const next = moveToInsert(steps, node.id, edge.insert);
            if (next) {
              onChange(next);
              setAnnouncement("Schritt verschoben.");
            }
          }}
          onConnect={connect}
          isValidConnection={(connection) =>
            Boolean(connection.sourceHandle) &&
            "steps" in
              resolveConnection(
                steps,
                connection.source,
                connection.sourceHandle as GraphHandle,
                connection.target,
              )
          }
          onEdgeClick={(_, edge) => setSelectedEdge(edge.data?.deletable ? edge.id : null)}
          onPaneClick={() => setSelectedEdge(null)}
          connectionRadius={36}
          connectionLineStyle={{ strokeDasharray: "4 3" }}
          nodesFocusable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          nodeDragThreshold={4}
          minZoom={0.2}
          maxZoom={1.5}
          panOnScroll
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
          style={THEME}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Panel position="bottom-left" className="!m-3">
            <ButtonGroup orientation="vertical" aria-label="Ansicht">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Vergrößern"
                title="Vergrößern"
                onClick={() => void flow.zoomIn({ duration: reduce ? 0 : 250, ease: SMOOTH_OUT })}
              >
                <PlusIcon />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Verkleinern"
                title="Verkleinern"
                onClick={() => void flow.zoomOut({ duration: reduce ? 0 : 250, ease: SMOOTH_OUT })}
              >
                <MinusIcon />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Einpassen"
                title="Einpassen"
                onClick={() => {
                  const viewport = home();
                  if (viewport)
                    void flow.setViewport(viewport, {
                      duration: reduce ? 0 : 250,
                      ease: SMOOTH_OUT,
                    });
                }}
              >
                <LocateFixedIcon />
              </Button>
            </ButtonGroup>
          </Panel>
          {width >= 560 && !fits && (
            <MiniMap
              pannable
              zoomable
              ariaLabel="Übersicht des Ablaufs"
              className="!m-3 overflow-hidden rounded-lg border shadow-xs"
              style={{ width: 120, height: 80 }}
            />
          )}
        </ReactFlow>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </section>
    </StepGraphContext.Provider>
  );
}
