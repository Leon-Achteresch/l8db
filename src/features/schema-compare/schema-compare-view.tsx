import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  GitCompareIcon,
  InfoIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useActiveConnection } from "@/lib/connections";
import type { CatalogObjectType } from "@/lib/db";
import {
  databaseFromConnectionString,
  useActiveDatabase,
  useActiveSchema,
} from "@/lib/db-selection";
import { useSchemasQuery } from "@/lib/queries";
import { buildSyncScript, renderSyncScript } from "@/lib/schema-compare/script";
import {
  activeTypes,
  connectionFor,
  reverseSchemaCompare,
  runSchemaCompare,
  setupProblem,
  useSchemaCompareStore,
} from "@/lib/schema-compare/store";
import type { CompareSide, DiffStatus } from "@/lib/schema-compare/types";
import { compareTypesFor, OBJECT_TYPE_META, STATUS_LABEL } from "@/lib/schema-compare/types";
import { cn } from "@/lib/utils";
import { SchemaCompareDetail } from "./schema-compare-detail";
import { SchemaCompareOptionsMenu } from "./schema-compare-options-menu";
import { SchemaCompareScript } from "./schema-compare-script";
import { SchemaCompareSideChip } from "./schema-compare-side-chip";
import { SchemaCompareSummary } from "./schema-compare-summary";
import { SchemaCompareTree, type TreeGrouping } from "./schema-compare-tree";
import { StatusMarker } from "./status-marker";

type Focus = { type: CatalogObjectType | null; status: DiffStatus };

const MARKERS = ["only_source", "different", "only_target"] as const;

function sameSide(a: CompareSide, b: CompareSide): boolean {
  return (
    a.connectionId === b.connectionId &&
    (a.database ?? "") === (b.database ?? "") &&
    a.schema === b.schema
  );
}

function comparedAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Gerade verglichen";
  if (minutes < 60) return `Verglichen vor ${minutes} Min.`;
  return `Verglichen um ${new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

export function SchemaCompareView() {
  const state = useSchemaCompareStore();
  const { result, selection, activeKey, loading, error, source, target } = state;
  const set = useSchemaCompareStore.setState;
  const [view, setView] = useState<"details" | "summary">("details");
  const [scriptOpen, setScriptOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showIdentical, setShowIdentical] = useState(false);
  const [grouping, setGrouping] = useState<TreeGrouping>("type");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const search = useDeferredValue(query.trim().toLowerCase());
  const active = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const activeReady = useSchemasQuery().isSuccess;
  const kind = connectionFor(source)?.kind ?? connectionFor(target)?.kind;
  const problem = setupProblem(source, target, activeTypes(state, kind));
  const stale = Boolean(
    result && (!sameSide(result.source, source) || !sameSide(result.target, target)),
  );

  useEffect(() => {
    if (!active || !activeReady || compareTypesFor(active.kind).length === 0) return;
    if (useSchemaCompareStore.getState().source.connectionId) return;
    set({
      source: {
        connectionId: active.id,
        database: activeDatabase ?? databaseFromConnectionString(active.connectionString),
        schema: activeSchema,
      },
    });
  }, [active, activeReady, activeDatabase, activeSchema]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(() => {
    if (!result) return [];
    return result.items.filter(
      (item) =>
        (!focus ||
          (item.status === focus.status && (focus.type === null || item.type === focus.type))) &&
        (!search ||
          item.name.toLowerCase().includes(search) ||
          (item.parent ?? "").toLowerCase().includes(search) ||
          OBJECT_TYPE_META[item.type].label.toLowerCase().includes(search)),
    );
  }, [result, focus, search]);

  const counts = useMemo(() => {
    const out: Record<DiffStatus, number> = {
      only_source: 0,
      only_target: 0,
      different: 0,
      identical: 0,
    };
    for (const item of result?.items ?? []) out[item.status]++;
    return out;
  }, [result]);

  const script = useMemo(
    () => (result ? buildSyncScript(result, selection) : { statements: [], warnings: [] }),
    [result, selection],
  );
  const text = useMemo(
    () =>
      result
        ? renderSyncScript(script, {
            kind: result.kind,
            sourceLabel: result.sourceLabel,
            targetLabel: result.targetLabel,
          })
        : "",
    [result, script],
  );
  const plan = useMemo(() => {
    const out = { create: 0, alter: 0, drop: 0 };
    for (const item of result?.items ?? []) {
      if (!selection[item.key]) continue;
      if (item.status === "only_source") out.create++;
      else if (item.status === "different") out.alter++;
      else if (item.status === "only_target") out.drop++;
    }
    return out;
  }, [result, selection]);
  const selectedCount = plan.create + plan.alter + plan.drop;
  const actionable = items.filter((item) => item.status !== "identical").map((item) => item.key);
  const actionableSelected = actionable.filter((key) => selection[key]).length;
  const visibleIdentical = items.filter((item) => item.status === "identical").length;

  const toggle = (keys: string[], checked: boolean) =>
    set((current) => {
      const next = { ...current.selection };
      for (const key of keys) {
        if (checked) next[key] = true;
        else delete next[key];
      }
      return { selection: next };
    });

  const runnable = !problem && !loading;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <SchemaCompareOptionsMenu />
        <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-4" />
        <SchemaCompareSideChip
          title="Quelle"
          value={source}
          other={target}
          onChange={(next) => set({ source: next })}
        />
        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <SchemaCompareSideChip
          title="Ziel"
          value={target}
          other={source}
          onChange={(next) => set({ target: next })}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={result && !stale ? "Richtung umkehren" : "Quelle und Ziel tauschen"}
          title={
            result && !stale
              ? `Quelle und Ziel tauschen und neu vergleichen. Das Skript ändert dann ${result.sourceLabel}.`
              : "Quelle und Ziel tauschen"
          }
          disabled={Boolean(loading)}
          onClick={() => {
            if (result && !stale) void reverseSchemaCompare();
            else set({ source: target, target: source });
          }}
        >
          <ArrowLeftRightIcon className="size-3.5" />
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {loading ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderIcon className="size-3.5 shrink-0 animate-spin" />
              <span className="truncate">{loading}</span>
            </span>
          ) : problem && (!result || stale) ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <InfoIcon className="size-3.5 shrink-0" />
              <span className="truncate">{problem}</span>
            </span>
          ) : result && !stale ? (
            <span className="truncate text-xs text-muted-foreground">
              {comparedAgo(result.comparedAt, now)}
            </span>
          ) : null}
          {result && !stale ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Neu vergleichen"
              title="Neu vergleichen"
              disabled={Boolean(loading)}
              onClick={() => void runSchemaCompare()}
            >
              <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          ) : (
            <Button
              size="sm"
              variant={result ? "outline" : "default"}
              className="h-7 gap-1.5 px-2.5 text-xs"
              disabled={!runnable}
              onClick={() => void runSchemaCompare()}
            >
              <GitCompareIcon className="size-3.5" />
              Vergleichen
            </Button>
          )}
        </div>
      </div>

      {!result ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {error ? (
            <p className="max-w-xl whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
              <GitCompareIcon className="size-5" />
              {problem ?? "Bereit zum Vergleichen."}
            </div>
          )}
        </div>
      ) : (
        <>
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel
              id="schema-compare-tree"
              defaultSize="30%"
              minSize="18%"
              className="flex min-w-0 flex-col"
            >
              <div className="flex shrink-0 flex-col gap-1.5 border-b px-2 py-1.5">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Objekt, Tabelle oder Typ suchen"
                    className="h-7 pl-7 text-xs"
                    aria-label="Unterschiede filtern"
                  />
                </div>
                <div className="flex items-center gap-2 px-1 text-xs">
                  <Checkbox
                    aria-label="Alle sichtbaren Unterschiede auswählen"
                    className="size-3.5"
                    disabled={actionable.length === 0}
                    checked={
                      actionableSelected === 0
                        ? false
                        : actionableSelected === actionable.length
                          ? true
                          : "indeterminate"
                    }
                    onCheckedChange={(checked) => toggle(actionable, checked === true)}
                  />
                  {MARKERS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={focus?.status === status && focus.type === null}
                      title={`Nur „${STATUS_LABEL[status]}“ anzeigen`}
                      disabled={counts[status] === 0}
                      className={cn(
                        "rounded px-1 py-0.5 hover:bg-accent disabled:opacity-40",
                        focus?.status === status && focus.type === null && "bg-accent",
                      )}
                      onClick={() =>
                        setFocus((current) =>
                          current?.status === status && current.type === null
                            ? null
                            : { type: null, status },
                        )
                      }
                    >
                      <StatusMarker status={status} count={counts[status]} />
                    </button>
                  ))}
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {selectedCount} ausgewählt
                  </span>
                </div>
                {focus && (
                  <button
                    type="button"
                    className="flex items-center gap-1 self-start rounded-md bg-accent px-1.5 py-0.5 text-xs"
                    onClick={() => setFocus(null)}
                  >
                    {focus.type ? `${OBJECT_TYPE_META[focus.type].plural} · ` : ""}
                    {STATUS_LABEL[focus.status]}
                    <XIcon className="size-3" />
                    <span className="sr-only">Filter aufheben</span>
                  </button>
                )}
              </div>
              {result.items.every((item) => item.status === "identical") && !showIdentical ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                  Keine Unterschiede gefunden.
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setShowIdentical(true)}
                  >
                    Identische anzeigen
                  </Button>
                </div>
              ) : (
                <SchemaCompareTree
                  items={items}
                  grouping={grouping}
                  identicalCount={visibleIdentical}
                  showIdentical={showIdentical || focus?.status === "identical"}
                  onShowIdenticalChange={setShowIdentical}
                  selection={selection}
                  activeKey={activeKey}
                  expandAll={Boolean(search) || Boolean(focus)}
                  onToggle={toggle}
                  onActivate={(key) => {
                    set({ activeKey: key });
                    setView("details");
                  }}
                />
              )}
              <div className="flex shrink-0 items-center border-t px-1 py-1">
                <Button
                  size="sm"
                  variant={view === "summary" ? "secondary" : "ghost"}
                  className="h-7 gap-1.5 px-2 text-xs"
                  aria-pressed={view === "summary"}
                  onClick={() => setView(view === "summary" ? "details" : "summary")}
                >
                  <TableIcon className="size-3.5" />
                  Zusammenfassung
                </Button>
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  spacing={0}
                  value={grouping}
                  onValueChange={(value) => value && setGrouping(value as TreeGrouping)}
                  aria-label="Gruppieren nach"
                  className="ml-auto"
                >
                  <ToggleGroupItem
                    value="type"
                    className="h-6 px-2 text-xs"
                    title="Nach Objekttyp gruppieren"
                  >
                    Typ
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="status"
                    className="h-6 px-2 text-xs"
                    title="Nach Unterschied gruppieren"
                  >
                    Status
                  </ToggleGroupItem>
                </ToggleGroup>
                <span
                  className="px-2 text-xs text-muted-foreground tabular-nums"
                  title={`${result.items.length} Objekte verglichen`}
                >
                  {result.items.length}
                </span>
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              id="schema-compare-detail"
              minSize="35%"
              className="flex min-w-0 flex-col"
            >
              {view === "summary" ? (
                <SchemaCompareSummary
                  result={result}
                  onPick={(type, status) => {
                    setFocus({ type, status });
                    setView("details");
                  }}
                />
              ) : (
                <SchemaCompareDetail result={result} activeKey={activeKey} />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
          <SchemaCompareScript
            result={result}
            script={script}
            text={text}
            plan={plan}
            open={scriptOpen}
            onOpenChange={setScriptOpen}
          />
          {error && (
            <div className="absolute inset-x-0 bottom-11 z-10 flex items-start gap-2 border-t bg-background/95 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-destructive">{error}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Fehler ausblenden"
                onClick={() => set({ error: null })}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
