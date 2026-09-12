import {
  addEdge,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import {
  CheckIcon,
  DatabaseIcon,
  FilterIcon,
  Link2Icon,
  ListOrderedIcon,
  type LucideIcon,
  PlusIcon,
  SendIcon,
  SigmaIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { FilterOperatorSelect } from "@/features/filters/filter-operator-select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import { useSettingsStore } from "@/lib/settings";
import type { FilterKind } from "@/lib/sql-filter";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveConnection } from "@/lib/connections";
import {
  AGG_LABEL,
  type Agg,
  BUCKET_LABEL,
  createId,
  type Dataset,
  isDateType,
  isNumericType,
  type SortMode,
  type TimeBucket,
} from "@/lib/dashboards";
import {
  defaultFlow,
  FLOW_NODE_LABEL,
  type FlowGraph,
  type FlowNode,
  type FlowNodeData,
  type FlowNodeType,
  flowChain,
  flowProblem,
  insertNode,
  makeRef,
  removeNode,
  splitRef,
  tableNodes,
  updateNodeData,
} from "@/lib/dataset-flow";
import { useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { useTablesQuery, useViewsQuery } from "@/lib/queries";
import { filterOperatorLabel, operatorNeedsValue } from "@/lib/sql-filter";
import { cn } from "@/lib/utils";
import { useRelations, useTablesColumns } from "./use-dataset-query";

const NONE = "__none__";

const ICONS: Record<FlowNodeType, LucideIcon> = {
  source: DatabaseIcon,
  join: Link2Icon,
  filter: FilterIcon,
  aggregate: SigmaIcon,
  sort: ListOrderedIcon,
  output: SendIcon,
};

const TONE: Record<FlowNodeType, string> = {
  source: "bg-lime-400 text-lime-950",
  join: "bg-blue-500 text-white",
  filter: "bg-pink-400 text-pink-950",
  aggregate: "bg-purple-400 text-purple-950",
  sort: "bg-amber-400 text-amber-950",
  output: "bg-teal-400 text-teal-950",
};

interface ColumnOpt {
  ref: string;
  label: string;
  type: string;
}

function summary(node: FlowNode, chain: FlowNode[], translated: boolean, kind: FilterKind): string {
  const d = node.data;
  const label = (ref: string) => {
    const { nodeId, column } = splitRef(ref);
    const n = chain.find((x) => x.id === nodeId);
    return n && "table" in n.data ? `${n.data.table}.${column}` : column;
  };
  switch (d.type) {
    case "source":
      return d.table || "Tabelle wählen";
    case "join":
      return d.table
        ? `${d.joinType} ${d.table}${d.toColumn ? ` · ${d.toColumn}` : ""}`
        : "Tabelle wählen";
    case "filter": {
      const active = d.conditions.filter((c) => c.ref);
      return active.length
        ? active
            .map((c) => `${label(c.ref)} ${filterOperatorLabel(c.operator, translated, kind)}`)
            .join(", ")
        : "Keine Bedingung";
    }
    case "aggregate":
      return `${d.dimension ? `nach ${label(d.dimension.ref)}` : "Gesamt"} · ${d.metrics.length} Kennzahl${d.metrics.length === 1 ? "" : "en"}`;
    case "sort":
      return `${d.sort === "dimension" ? "nach Aufteilung" : d.sort === "metric_desc" ? "größte zuerst" : "kleinste zuerst"} · max. ${d.limit}`;
    case "output":
      return d.dateColumn ? `Zeitspalte ${label(d.dateColumn)}` : "Ergebnis";
  }
}

type StepNode = Node<{ node: FlowNode; text: string; onRemove?: () => void }, "step">;

function StepNodeView({ data, selected }: NodeProps<StepNode>) {
  const type = data.node.data.type;
  const Icon = ICONS[type];
  return (
    <div
      className={cn(
        "w-52 rounded-xl border bg-card px-3 py-2 shadow-sm transition-colors",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      {type !== "source" && (
        <Handle type="target" position={Position.Left} className="!size-2.5 !bg-muted-foreground" />
      )}
      <div className="flex items-center gap-2">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", TONE[type])}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">{FLOW_NODE_LABEL[type]}</div>
          <div className="truncate text-[10px] text-muted-foreground" title={data.text}>
            {data.text}
          </div>
        </div>
        {data.onRemove && (
          <IconButton
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label="Knoten entfernen"
            onClick={(e) => {
              e.stopPropagation();
              data.onRemove?.();
            }}
            className="nodrag rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3" />
          </IconButton>
        )}
      </div>
      {type !== "output" && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2.5 !bg-muted-foreground"
        />
      )}
    </div>
  );
}

const nodeTypes = { step: StepNodeView };

function ColumnSelect({
  value,
  onChange,
  columns,
  placeholder = "Spalte wählen",
  allowNone,
  filter,
}: {
  value: string | null;
  onChange: (ref: string | null) => void;
  columns: ColumnOpt[];
  placeholder?: string;
  allowNone?: string;
  filter?: (col: ColumnOpt) => boolean;
}) {
  const list = filter ? columns.filter(filter) : columns;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className="h-8 w-full text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent searchable>
        {allowNone && <SelectItem value={NONE}>{allowNone}</SelectItem>}
        {list.map((col) => (
          <SelectItem key={col.ref} value={col.ref}>
            <span className="truncate">{col.label}</span>
            <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground">
              {col.type}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TableSelect({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (table: string) => void;
  placeholder: string;
}) {
  const tables = useTablesQuery();
  const views = useViewsQuery();
  return (
    <Select value={value || NONE} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-8 w-full text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent searchable>
        <SelectGroup>
          <SelectLabel>Tabellen</SelectLabel>
          {(tables.data ?? []).map((t) => (
            <SelectItem key={`t:${t.name}`} value={t.name}>
              {t.name}
            </SelectItem>
          ))}
        </SelectGroup>
        {(views.data?.length ?? 0) > 0 && (
          <SelectGroup>
            <SelectLabel>Views</SelectLabel>
            {(views.data ?? []).map((v) => (
              <SelectItem key={`v:${v.name}`} value={v.name}>
                {v.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function NodeConfig({
  node,
  chain,
  columns,
  columnsOf,
  onChange,
}: {
  node: FlowNode;
  chain: FlowNode[];
  columns: ColumnOpt[];
  columnsOf: (nodeId: string) => ColumnOpt[];
  onChange: (data: FlowNodeData) => void;
}) {
  const connection = useActiveConnection();
  const schema = useActiveSchema();
  const d = node.data;
  const source = chain[0];
  const sourceTable = source?.data.type === "source" ? source.data : null;
  const relations = useRelations(sourceTable?.schema ?? "", sourceTable?.table ?? "");
  const typeOf = (ref: string | null) => columns.find((c) => c.ref === ref)?.type ?? "";
  const hasAggregate = chain.some((n) => n.data.type === "aggregate");

  switch (d.type) {
    case "source":
      return (
        <Field label="Tabelle oder View">
          <TableSelect
            value={d.table}
            onChange={(table) => onChange({ ...d, schema, table })}
            placeholder="Tabelle wählen"
          />
        </Field>
      );
    case "join": {
      const suggestions = supports(connection, "foreign_keys") && sourceTable ? relations : [];
      const upstream = columns.filter((c) => splitRef(c.ref).nodeId !== node.id);
      const own = columnsOf(node.id);
      return (
        <div className="space-y-2">
          {suggestions.length > 0 && (
            <Field label="Aus Fremdschlüssel übernehmen">
              <Select
                value={NONE}
                onValueChange={(v) => {
                  const r = suggestions.find((x) => x.key === v);
                  if (r && source)
                    onChange({
                      ...d,
                      schema: r.join.schema,
                      table: r.join.table,
                      fromRef: makeRef(source.id, r.join.fromColumn),
                      toColumn: r.join.toColumn,
                    });
                }}
              >
                <SelectTrigger size="sm" className="h-8 w-full text-xs">
                  <SelectValue placeholder="Vorschlag wählen" />
                </SelectTrigger>
                <SelectContent searchable>
                  {suggestions.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      <WandSparklesIcon className="size-3" /> {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Tabelle">
            <TableSelect
              value={d.table}
              onChange={(table) => onChange({ ...d, schema, table, toColumn: "" })}
              placeholder="Tabelle wählen"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Art">
              <Select
                value={d.joinType}
                onValueChange={(joinType) =>
                  onChange({ ...d, joinType: joinType as "LEFT" | "INNER" })
                }
              >
                <SelectTrigger size="sm" className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LEFT">LEFT (alle Zeilen behalten)</SelectItem>
                  <SelectItem value="INNER">INNER (nur Treffer)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Spalte in der neuen Tabelle">
              <Select
                value={d.toColumn || NONE}
                onValueChange={(toColumn) => onChange({ ...d, toColumn })}
              >
                <SelectTrigger size="sm" className="h-8 w-full text-xs">
                  <SelectValue placeholder="Spalte" />
                </SelectTrigger>
                <SelectContent searchable>
                  {own.map((c) => (
                    <SelectItem key={c.ref} value={splitRef(c.ref).column}>
                      {splitRef(c.ref).column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Passende Spalte aus der Kette davor">
            <ColumnSelect
              value={d.fromRef || null}
              onChange={(fromRef) => onChange({ ...d, fromRef: fromRef ?? "" })}
              columns={upstream}
            />
          </Field>
        </div>
      );
    }
    case "filter":
      return (
        <div className="space-y-2">
          {d.conditions.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[1fr_auto] gap-1.5 rounded-lg border bg-background/60 p-2"
            >
              <ColumnSelect
                value={c.ref || null}
                onChange={(ref) =>
                  onChange({
                    ...d,
                    conditions: d.conditions.map((x) =>
                      x.id === c.id
                        ? {
                            ...x,
                            ref: ref ?? "",
                            dataType: columns.find((entry) => entry.ref === ref)?.type,
                          }
                        : x,
                    ),
                  })
                }
                columns={columns}
              />
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Bedingung entfernen"
                onClick={() =>
                  onChange({ ...d, conditions: d.conditions.filter((x) => x.id !== c.id) })
                }
              >
                <XIcon />
              </IconButton>
              <div className="col-span-2 flex gap-1.5">
                <FilterOperatorSelect
                  operator={c.operator}
                  value={c.value}
                  onChange={(operator, value) =>
                    onChange({
                      ...d,
                      conditions: d.conditions.map((x) =>
                        x.id === c.id ? { ...x, operator, value } : x,
                      ),
                    })
                  }
                  className="h-8 flex-1 text-xs"
                  size="sm"
                />
                {operatorNeedsValue(c.operator) && (
                  <FilterValueInput
                    key={c.operator}
                    operator={c.operator}
                    className="h-8 flex-1 text-xs"
                    placeholder="Wert"
                    value={c.value}
                    onValueChange={(value) =>
                      onChange({
                        ...d,
                        conditions: d.conditions.map((x) => (x.id === c.id ? { ...x, value } : x)),
                      })
                    }
                  />
                )}
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              onChange({
                ...d,
                conditions: [
                  ...d.conditions,
                  { id: createId(), ref: "", operator: "eq", value: "" },
                ],
              })
            }
          >
            <PlusIcon /> Bedingung
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Alle Bedingungen müssen zutreffen (UND). Sie gelten auf die Rohzeilen vor der
            Gruppierung.
          </p>
        </div>
      );
    case "aggregate":
      return (
        <div className="space-y-2">
          <Field label="Aufteilen nach">
            <ColumnSelect
              value={d.dimension?.ref ?? null}
              onChange={(ref) =>
                onChange({
                  ...d,
                  dimension: ref
                    ? { ref, bucket: isDateType(typeOf(ref)) ? "month" : "none" }
                    : null,
                })
              }
              columns={columns}
              allowNone="Nicht aufteilen (nur Gesamtwert)"
            />
          </Field>
          {d.dimension && isDateType(typeOf(d.dimension.ref)) && (
            <Select
              value={d.dimension.bucket}
              onValueChange={(bucket) =>
                onChange({
                  ...d,
                  dimension: { ref: d.dimension?.ref ?? "", bucket: bucket as TimeBucket },
                })
              }
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BUCKET_LABEL) as TimeBucket[]).map((b) => (
                  <SelectItem key={b} value={b}>
                    {BUCKET_LABEL[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Field label="Zweite Aufteilung (Fluss, Heatmap)">
            <ColumnSelect
              value={d.dimension2}
              onChange={(dimension2) => onChange({ ...d, dimension2 })}
              columns={columns}
              allowNone="Keine"
            />
          </Field>
          <Field label="Kennzahlen">
            <div className="space-y-1.5">
              {d.metrics.map((m) => (
                <div key={m.id} className="space-y-1.5 rounded-lg border bg-background/60 p-2">
                  <div className="flex gap-1.5">
                    <Select
                      value={m.agg}
                      onValueChange={(agg) =>
                        onChange({
                          ...d,
                          metrics: d.metrics.map((x) =>
                            x.id === m.id ? { ...x, agg: agg as Agg } : x,
                          ),
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(AGG_LABEL) as Agg[]).map((agg) => (
                          <SelectItem key={agg} value={agg}>
                            {AGG_LABEL[agg]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {d.metrics.length > 1 && (
                      <IconButton
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Kennzahl entfernen"
                        onClick={() =>
                          onChange({ ...d, metrics: d.metrics.filter((x) => x.id !== m.id) })
                        }
                      >
                        <XIcon />
                      </IconButton>
                    )}
                  </div>
                  {m.agg !== "count" && (
                    <ColumnSelect
                      value={m.ref}
                      onChange={(ref) =>
                        onChange({
                          ...d,
                          metrics: d.metrics.map((x) => (x.id === m.id ? { ...x, ref } : x)),
                        })
                      }
                      columns={columns}
                      filter={
                        m.agg === "sum" || m.agg === "avg"
                          ? (c) => isNumericType(c.type)
                          : undefined
                      }
                    />
                  )}
                  <Input
                    className="h-7 text-xs"
                    placeholder="Bezeichnung im Chart (optional)"
                    value={m.label}
                    onChange={(e) =>
                      onChange({
                        ...d,
                        metrics: d.metrics.map((x) =>
                          x.id === m.id ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              {d.metrics.length < 6 && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    onChange({
                      ...d,
                      metrics: [...d.metrics, { id: createId(), agg: "sum", ref: null, label: "" }],
                    })
                  }
                >
                  <PlusIcon /> Kennzahl
                </Button>
              )}
            </div>
          </Field>
        </div>
      );
    case "sort":
      return (
        <div className="flex gap-1.5">
          <Select
            value={d.sort}
            onValueChange={(sort) => onChange({ ...d, sort: sort as SortMode })}
          >
            <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dimension">Nach Aufteilung (A→Z, alt→neu)</SelectItem>
              <SelectItem value="metric_desc">Größte Kennzahl zuerst</SelectItem>
              <SelectItem value="metric_asc">Kleinste Kennzahl zuerst</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={5000}
            className="h-8 w-20 text-xs"
            aria-label="Maximale Anzahl"
            value={d.limit}
            onChange={(e) => onChange({ ...d, limit: Number(e.target.value) || 50 })}
          />
        </div>
      );
    case "output":
      return (
        <div className="space-y-2">
          {hasAggregate ? (
            <p className="text-[11px] text-muted-foreground">
              Aufteilung und Kennzahlen kommen aus der Gruppierung.
            </p>
          ) : (
            <>
              <Field label="Aufteilung (Kategorie je Zeile)">
                <ColumnSelect
                  value={d.dimension}
                  onChange={(dimension) => onChange({ ...d, dimension })}
                  columns={columns}
                  allowNone="Keine"
                />
              </Field>
              <Field label="Werte (Reihenfolge = Klickreihenfolge)">
                <div className="flex flex-wrap gap-1.5">
                  {columns.map((c) => {
                    const idx = d.values.indexOf(c.ref);
                    return (
                      <button
                        key={c.ref}
                        type="button"
                        aria-pressed={idx >= 0}
                        onClick={() =>
                          onChange({
                            ...d,
                            values:
                              idx >= 0 ? d.values.filter((v) => v !== c.ref) : [...d.values, c.ref],
                          })
                        }
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                          idx >= 0 && "border-lime-400 bg-lime-400/15 font-medium",
                        )}
                      >
                        {idx >= 0 && <CheckIcon className="size-3" />}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </>
          )}
          <Field label="Zeitspalte für Zeitraum-Filter">
            <ColumnSelect
              value={d.dateColumn}
              onChange={(dateColumn) => onChange({ ...d, dateColumn })}
              columns={columns}
              filter={(c) => isDateType(c.type)}
              allowNone="Keine Zeitspalte"
            />
          </Field>
        </div>
      );
  }
}

function FlowCanvas({
  dataset,
  onChange,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
}) {
  const translatedOperators = useSettingsStore((state) => state.translateFilterOperators);
  const kind = useActiveConnection()?.kind;
  const flow = dataset.flow ?? defaultFlow();
  const setFlow = (next: FlowGraph) => onChange({ flow: next });
  const chain = useMemo(() => flowChain(flow), [flow]);
  const [selectedId, setSelectedId] = useState<string | null>(chain[0]?.id ?? null);
  const selected = flow.nodes.find((n) => n.id === selectedId) ?? chain[0] ?? null;
  const tables = tableNodes(chain).map((n) => ({
    id: n.id,
    schema: "schema" in n.data ? n.data.schema : "",
    table: "table" in n.data ? n.data.table : "",
  }));
  const columnQueries = useTablesColumns(tables);
  const columnsOf = (nodeId: string): ColumnOpt[] => {
    const i = tables.findIndex((t) => t.id === nodeId);
    if (i < 0) return [];
    return (columnQueries[i]?.data ?? []).map((c) => ({
      ref: makeRef(nodeId, c.name),
      label: `${tables[i].table}.${c.name}`,
      type: c.data_type,
    }));
  };
  const upstreamOf = (node: FlowNode): ColumnOpt[] => {
    const idx = chain.findIndex((n) => n.id === node.id);
    const visible = idx < 0 ? chain : chain.slice(0, idx + 1);
    return tableNodes(visible).flatMap((n) => columnsOf(n.id));
  };
  const problem = flowProblem(flow);
  const hasAggregate = chain.some((n) => n.data.type === "aggregate");
  const hasSort = chain.some((n) => n.data.type === "sort");

  const nodes: StepNode[] = flow.nodes.map((n) => ({
    id: n.id,
    type: "step",
    position: n.position,
    selected: n.id === selected?.id,
    data: {
      node: n,
      text: summary(n, chain, translatedOperators, kind),
      onRemove:
        n.data.type === "source" || n.data.type === "output"
          ? undefined
          : () => {
              setFlow(removeNode(flow, n.id));
              if (selectedId === n.id) setSelectedId(chain[0]?.id ?? null);
            },
    },
  }));
  const edges: Edge[] = flow.edges.map((e) => ({ ...e, animated: true }));

  const onNodesChange = (changes: NodeChange<StepNode>[]) => {
    const moved = applyNodeChanges(changes, nodes);
    const positions = new Map(moved.map((n) => [n.id, n.position]));
    if (changes.some((c) => c.type === "position"))
      setFlow({
        ...flow,
        nodes: flow.nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
      });
    for (const c of changes) if (c.type === "select" && c.selected) setSelectedId(c.id);
  };
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const kept = flow.edges.filter((e) => e.target !== c.target);
    const next = addEdge(
      { id: createId(), source: c.source, target: c.target },
      kept,
    ) as FlowEdge[];
    setFlow({
      ...flow,
      edges: next.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["join", "filter", "aggregate", "sort"] as FlowNodeType[]).map((type) => {
          const Icon = ICONS[type];
          const disabled = (type === "aggregate" && hasAggregate) || (type === "sort" && hasSort);
          return (
            <Button
              key={type}
              variant="outline"
              size="xs"
              disabled={disabled}
              onClick={() => {
                const next = insertNode(flow, type);
                setFlow(next);
                setSelectedId(
                  flowChain(next).find((n) => !flow.nodes.some((o) => o.id === n.id))?.id ?? null,
                );
              }}
            >
              <PlusIcon /> <Icon className="size-3" /> {FLOW_NODE_LABEL[type]}
            </Button>
          );
        })}
      </div>
      <div className="h-56 overflow-hidden rounded-xl border bg-background/60">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={(changes) => {
            const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
            if (removed.length)
              setFlow({ ...flow, edges: flow.edges.filter((e) => !removed.includes(e.id)) });
          }}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.4}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={14} size={1} />
        </ReactFlow>
      </div>
      {problem && <p className="text-[11px] text-amber-600 dark:text-amber-400">{problem}</p>}
      {selected && (
        <section className="rounded-xl border bg-card/60 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={cn("grid size-5 place-items-center rounded-md", TONE[selected.data.type])}
            >
              {(() => {
                const Icon = ICONS[selected.data.type];
                return <Icon className="size-3" />;
              })()}
            </span>
            <h3 className="text-xs font-semibold">{FLOW_NODE_LABEL[selected.data.type]}</h3>
          </div>
          <NodeConfig
            key={selected.id}
            node={selected}
            chain={chain}
            columns={upstreamOf(selected)}
            columnsOf={columnsOf}
            onChange={(data) => setFlow(updateNodeData(flow, selected.id, data))}
          />
        </section>
      )}
    </div>
  );
}

type FlowEdge = { id: string; source: string; target: string };

export function FlowBuilder(props: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
