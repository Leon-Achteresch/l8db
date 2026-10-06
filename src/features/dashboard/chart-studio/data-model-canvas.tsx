import { MousePointerClickIcon, PlusIcon, SigmaIcon, Table2Icon, XIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type CalculatedField,
  calcRef,
  type DatasetJoin,
  emptySimple,
  type SimpleDataset,
  suggestJoins,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { CHART_FIELD_MIME } from "../chart-visual-builder-model";
import { type DatasetColumn, useTablesColumns } from "../use-dataset-query";
import { CalcFieldEditor } from "./calc-field-editor";
import { JoinPill } from "./join-pill";
import { JoinSuggestionChip, type StudioSuggestion } from "./join-suggestion-chip";
import {
  addJoin,
  type JoinColumnDrag,
  nodeColumns,
  nodeDepth,
  removeJoin,
  SOURCE_TABLE_MIME,
  type StudioNode,
  studioNodes,
  updateJoin,
} from "./studio-model";
import type { SourceTable } from "./studio-source-list";
import { StudioTableCard } from "./studio-table-card";

interface Link {
  id: string;
  path: string;
  mid: { x: number; y: number };
}

export function DataModelCanvas({
  simple,
  columns,
  fkJoins,
  pending,
  selected,
  used,
  onPending,
  onSelect,
  onChange,
  onPickSource,
}: {
  simple: SimpleDataset;
  columns: DatasetColumn[];
  fkJoins: (DatasetJoin & { id: string })[];
  pending: SourceTable | null;
  selected: string | null;
  used: Set<string>;
  onPending: (source: SourceTable | null) => void;
  onSelect: (ref: string | null) => void;
  onChange: (simple: SimpleDataset) => void;
  onPickSource: (source: SourceTable) => void;
}) {
  const nodes = useMemo(() => studioNodes(simple), [simple]);
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [over, setOver] = useState(false);
  const [calcOpen, setCalcOpen] = useState<string | null>(null);
  const formulas = useNewFeatureVisibility<HTMLDivElement>("dashboard.studio.formulas");
  const joinsFeature = useNewFeatureVisibility<HTMLDivElement>("dashboard.studio.joins");
  const [opened, setOpened] = useState<string | null>(null);
  const pendingColumns = useTablesColumns(pending ? [pending] : [])[0];
  const pendingCols: DatasetColumn[] = (pendingColumns?.data ?? []).map((c) => ({
    ref: `pending:${c.name}`,
    label: c.name,
    type: c.data_type,
    column: c.name,
  }));

  const columns0 = useMemo(() => {
    const byDepth: StudioNode[][] = [];
    for (const node of nodes) {
      const depth = nodeDepth(nodes, node);
      byDepth[depth] = [...(byDepth[depth] ?? []), node];
    }
    return byDepth;
  }, [nodes]);

  const measure = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    setSize({ w: root.scrollWidth, h: root.scrollHeight });
    const next: Link[] = [];
    for (const node of nodes) {
      if (node.parent === null) continue;
      const from = cards.current.get(node.parent);
      const to = cards.current.get(node.id);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.right - box.left + root.scrollLeft;
      const y1 = a.top - box.top + root.scrollTop + 22;
      const x2 = b.left - box.left + root.scrollLeft;
      const y2 = b.top - box.top + root.scrollTop + 22;
      const dx = Math.max(30, (x2 - x1) / 2);
      next.push({
        id: node.id,
        path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      });
    }
    setLinks(next);
  }, [nodes]);

  useLayoutEffect(() => {
    measure();
    const root = container.current;
    if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (content.current) observer.observe(content.current);
    for (const el of cards.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const tableNames = (node: StudioNode) =>
    nodeColumns(columns, node).map((c) => c.column ?? c.label);
  const pendingNames = pendingCols.map((c) => c.column ?? c.label).join("\u0000");

  const suggestions = useMemo<StudioSuggestion[]>(() => {
    if (!pending || !pendingNames) return [];
    const target = { schema: pending.schema, table: pending.table };
    const out: StudioSuggestion[] = [];
    for (const fk of fkJoins)
      if (fk.schema === pending.schema && fk.table === pending.table) {
        const parent = nodes.find((n) => n.id === (fk.parent ?? ""));
        if (parent)
          out.push({
            node: parent.id,
            parent,
            target,
            fromColumn: fk.fromColumn,
            toColumn: fk.toColumn,
            reason: "Fremdschlüssel",
          });
      }
    for (const node of nodes) {
      const found = suggestJoins(
        {
          schema: node.schema,
          table: node.table,
          columns: nodeColumns(columns, node).map((c) => c.column ?? c.label),
        },
        [{ ...target, columns: pendingNames.split("\u0000") }],
        4,
      );
      for (const s of found)
        if (
          !out.some(
            (o) => o.node === node.id && o.fromColumn === s.fromColumn && o.toColumn === s.toColumn,
          )
        )
          out.push({
            node: node.id,
            parent: node,
            target,
            fromColumn: s.fromColumn,
            toColumn: s.toColumn,
            reason: s.reason === "name" ? "Name passt" : "gleiche Spalte",
          });
    }
    return out.slice(0, 5);
  }, [pending, pendingNames, fkJoins, nodes, columns]);

  const connect = (parent: string, fromColumn: string, toColumn: string) => {
    if (!pending) return;
    const { simple: next, id } = addJoin(simple, parent, pending, fromColumn, toColumn);
    onChange(next);
    onPending(null);
    setOpened(id);
  };

  const saveCalc = (field: CalculatedField) => {
    const list = simple.calculated ?? [];
    onChange({
      ...simple,
      calculated: list.some((c) => c.id === field.id)
        ? list.map((c) => (c.id === field.id ? field : c))
        : [...list, field],
    });
  };

  const deleteCalc = (id: string) => {
    const ref = calcRef(id);
    const metrics = simple.metrics.filter((m) => m.column !== ref);
    onChange({
      ...simple,
      calculated: (simple.calculated ?? []).filter((c) => c.id !== id),
      metrics: metrics.length
        ? metrics
        : [{ id: "count", agg: "count", column: null, label: "Anzahl" }],
      dimension: simple.dimension?.column === ref ? null : simple.dimension,
      dimension2: simple.dimension2 === ref ? null : simple.dimension2,
      filters: simple.filters.filter((f) => f.column !== ref),
    });
    setCalcOpen(null);
  };

  const setCard = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cards.current.set(id, el);
    else cards.current.delete(id);
  };

  const calcFields = simple.calculated ?? [];

  return (
    <section
      aria-label="Datenmodell"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(SOURCE_TABLE_MIME)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        const raw = event.dataTransfer.getData(SOURCE_TABLE_MIME);
        setOver(false);
        if (!raw) return;
        event.preventDefault();
        onPickSource(JSON.parse(raw) as SourceTable);
      }}
      className={cn(
        "relative rounded-2xl border bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [background-size:16px_16px] transition-colors",
        over && "border-primary bg-primary/5",
      )}
    >
      {nodes.length === 0 ? (
        <div className="grid min-h-72 place-items-center p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-20 w-44">
              <div className="studio-ghost-card absolute inset-x-6 top-2 flex h-16 items-center gap-2 rounded-xl border bg-card px-3 shadow-sm">
                <Table2Icon className="size-4 text-primary" />
                <div className="space-y-1.5">
                  <div className="h-1.5 w-16 rounded bg-muted-foreground/30" />
                  <div className="h-1.5 w-10 rounded bg-muted-foreground/20" />
                </div>
              </div>
              <MousePointerClickIcon className="studio-ghost-pointer absolute right-6 bottom-0 size-5 text-foreground/70" />
            </div>
            <p className="text-sm font-semibold">Ziehe deine erste Tabelle hierher</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Oder klicke links auf eine Tabelle. Weitere Tabellen verbindest du danach per Klick
              auf einen Vorschlag oder indem du Spalte auf Spalte ziehst.
            </p>
          </div>
        </div>
      ) : (
        <div ref={container} className="relative overflow-auto p-6">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0"
            width={size.w}
            height={size.h}
          >
            {links.map((link) => (
              <path
                key={link.id}
                d={link.path}
                className="fill-none stroke-primary/50"
                strokeWidth={1.5}
              />
            ))}
          </svg>
          <div ref={content} className="relative flex w-max items-start gap-52">
            {columns0.map((column, depth) => (
              <div key={column.map((n) => n.id).join("|") || depth} className="flex flex-col gap-6">
                {column.map((node, index) => {
                  const parent = nodes.find((n) => n.id === node.parent);
                  return (
                    <StudioTableCard
                      key={node.id || "base"}
                      ref={setCard(node.id)}
                      nodeId={node.id}
                      title={node.table}
                      subtitle={
                        node.join
                          ? `über ${parent?.table ?? ""}.${node.join.fromColumn}`
                          : "Ausgangstabelle"
                      }
                      columns={nodeColumns(columns, node)}
                      color={depth * 3 + index}
                      used={used}
                      selected={selected}
                      onSelect={onSelect}
                      onRemove={
                        node.join
                          ? () => onChange(removeJoin(simple, node.id))
                          : () => {
                              if (
                                nodes.length === 1 ||
                                window.confirm(
                                  "Ausgangstabelle wechseln? Verknüpfungen und Felder werden zurückgesetzt.",
                                )
                              ) {
                                onPending(null);
                                onChange(emptySimple());
                              }
                            }
                      }
                    />
                  );
                })}
                {depth === 0 && (
                  <div
                    ref={formulas.ref}
                    className="w-60 rounded-xl border bg-card/80 p-2 shadow-xs"
                  >
                    <div className="mb-1 flex items-center gap-1.5 px-1">
                      <SigmaIcon className="size-3.5 text-primary" />
                      <p className="flex-1 text-xs font-semibold">Berechnete Felder</p>
                      {formulas.isNew && <NewBadge />}
                    </div>
                    <ul className="space-y-0.5">
                      {calcFields.map((field) => (
                        <li key={field.id}>
                          <Popover
                            open={calcOpen === field.id}
                            onOpenChange={(open) => setCalcOpen(open ? field.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.setData(CHART_FIELD_MIME, calcRef(field.id));
                                  event.dataTransfer.effectAllowed = "copy";
                                }}
                                className={cn(
                                  "flex w-full cursor-grab items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                                  used.has(calcRef(field.id)) && "font-medium text-primary",
                                )}
                              >
                                <span className="font-mono text-[10px] text-primary">ƒx</span>
                                <span className="min-w-0 flex-1 truncate">{field.label}</span>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[28rem]" side="right" align="start">
                              <CalcFieldEditor
                                field={field}
                                simple={simple}
                                columns={columns}
                                onSave={saveCalc}
                                onDelete={() => deleteCalc(field.id)}
                                onDone={() => setCalcOpen(null)}
                              />
                            </PopoverContent>
                          </Popover>
                        </li>
                      ))}
                    </ul>
                    <Popover
                      open={calcOpen === "new"}
                      onOpenChange={(open) => setCalcOpen(open ? "new" : null)}
                    >
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="xs" className="mt-1 w-full justify-start">
                          <PlusIcon /> Formel hinzufügen
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[28rem]" side="right" align="start">
                        <CalcFieldEditor
                          field={null}
                          simple={simple}
                          columns={columns}
                          onSave={saveCalc}
                          onDone={() => setCalcOpen(null)}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>
            ))}
            {pending && (
              <div className="studio-pending-in flex flex-col gap-3">
                <StudioTableCard
                  ref={setCard("__pending")}
                  nodeId="__pending"
                  title={pending.table}
                  subtitle="Noch nicht verbunden"
                  columns={pendingCols}
                  loading={pendingColumns?.isLoading}
                  color={7}
                  used={new Set()}
                  selected={null}
                  pending
                  onSelect={() => undefined}
                  onRemove={() => onPending(null)}
                  onJoinDrop={(drag: JoinColumnDrag, column) =>
                    connect(drag.node, drag.column, column)
                  }
                />
                <div
                  ref={joinsFeature.ref}
                  className="w-64 space-y-2 rounded-xl border bg-card p-2.5 shadow-sm"
                >
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    Wie gehören die Daten zusammen?
                    {joinsFeature.isNew && <NewBadge />}
                  </p>
                  {suggestions.length > 0 ? (
                    <div className="space-y-1.5">
                      {suggestions.map((s, index) => (
                        <JoinSuggestionChip
                          key={`${s.node}:${s.fromColumn}:${s.toColumn}`}
                          suggestion={s}
                          measure={index < 3}
                          onPick={() => connect(s.node, s.fromColumn, s.toColumn)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      {pendingColumns?.isLoading
                        ? "Suche passende Spalten…"
                        : "Kein automatischer Vorschlag gefunden."}
                    </p>
                  )}
                  <p className="studio-drag-hint flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                    <span className="studio-drag-dot size-1.5 shrink-0 rounded-full bg-primary" />
                    Oder ziehe eine Spalte aus einer Karte auf die passende Spalte hier.
                  </p>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="w-full"
                    onClick={() => onPending(null)}
                  >
                    <XIcon /> Abbrechen
                  </Button>
                </div>
              </div>
            )}
          </div>
          {links.map((link) => {
            const node = nodes.find((n) => n.id === link.id);
            const parent = node && nodes.find((n) => n.id === node.parent);
            if (!node?.join || !parent) return null;
            return (
              <JoinPill
                key={`${link.id}:pill`}
                node={{ ...node, join: node.join }}
                parent={parent}
                parentColumns={tableNames(parent)}
                columns={tableNames(node)}
                defaultOpen={opened === node.id}
                style={{ left: link.mid.x, top: link.mid.y }}
                onChange={(patch) => onChange(updateJoin(simple, node.id, patch))}
                onRemove={() => onChange(removeJoin(simple, node.id))}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
