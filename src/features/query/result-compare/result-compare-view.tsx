import { Maximize2, Minimize2 } from "lucide";
import {
  ArrowRightIcon,
  CircleCheckIcon,
  GitCompareArrowsIcon,
  HistoryIcon,
  PinIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { type ReactNode, type SetStateAction, useMemo, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import type { QueryResult } from "@/lib/db";
import { useActiveMasks } from "@/lib/masking-display";
import {
  compareResults,
  detectKeyColumns,
  type ResultChangeKind,
  type ResultRuns,
  resultCompareLimit,
} from "@/lib/result-compare";
import { tabStateKey, useTabState } from "@/lib/tab-state";
import { cn } from "@/lib/utils";
import { ResultCompareDetail } from "./result-compare-detail";
import { ResultCompareKeyMenu } from "./result-compare-key-menu";
import { ResultCompareList } from "./result-compare-list";
import { ResultCompareMap } from "./result-compare-map";
import { ResultCompareNotice } from "./result-compare-notice";
import { CHANGE_TONE } from "./tone";

type Filter = "all" | ResultChangeKind;

const KINDS: ResultChangeKind[] = ["changed", "added", "removed"];

const clock = (at: number) => new Date(at).toLocaleTimeString("de-DE");

const rowsLabel = (count: number) =>
  `${count.toLocaleString("de-DE")} Zeile${count === 1 ? "" : "n"}`;

const sameSql = (left: string, right: string) =>
  left.replace(/\s+/g, " ").trim() === right.replace(/\s+/g, " ").trim();

export function ResultCompareView({
  scope,
  result,
  runs,
  onRunsChange,
  connectionId,
  database,
  actions,
  maximized,
  onToggleMaximized,
}: {
  scope: string;
  result: QueryResult | null;
  runs: ResultRuns;
  onRunsChange: (next: SetStateAction<ResultRuns>) => void;
  connectionId: string | null;
  database: string | null;
  actions: ReactNode;
  maximized: boolean;
  onToggleMaximized: () => void;
}) {
  const [chosenKey, setChosenKey] = useTabState<string[] | null>(
    tabStateKey(scope, "compareKey"),
    null,
  );
  const [filter, setFilter] = useTabState<Filter>(tabStateKey(scope, "compareFilter"), "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { baseline, latest } = runs;
  const foreign =
    latest !== null && (latest.connectionId !== connectionId || latest.database !== database);
  const pair = baseline && latest && !foreign ? { baseline, latest } : null;
  const before = pair?.baseline.result ?? null;
  const after = pair?.latest.result ?? null;

  const detected = useMemo(
    () => (before && after ? detectKeyColumns(before, after) : []),
    [before, after],
  );
  const keyColumns = chosenKey ?? detected;
  const comparison = useMemo(
    () => (before && after ? compareResults(before, after, keyColumns) : null),
    [before, after, keyColumns],
  );
  const columns = useMemo(
    () =>
      comparison && after
        ? [...after.columns, ...comparison.columns.removed]
        : (after?.columns ?? []),
    [after, comparison],
  );
  const { active: masks } = useActiveMasks(columns);
  const activeFilter: Filter =
    filter !== "all" && comparison && comparison.counts[filter] === 0 ? "all" : filter;
  const visible = useMemo(
    () =>
      !comparison
        ? []
        : activeFilter === "all"
          ? comparison.changes
          : comparison.changes.filter((change) => change.kind === activeFilter),
    [comparison, activeFilter],
  );
  const selected = visible.find((change) => change.id === selectedId) ?? visible[0] ?? null;

  let body: ReactNode;
  if (!latest) {
    const limit = result ? resultCompareLimit(result) : null;
    body = limit ? (
      <ResultCompareNotice
        icon={<TriangleAlertIcon />}
        title="Dieses Ergebnis wird nicht verglichen"
      >
        {limit}
      </ResultCompareNotice>
    ) : (
      <ResultCompareNotice icon={<HistoryIcon />} title="Noch nichts zu vergleichen">
        Führe die Abfrage aus. l8db vergleicht jedes Ergebnis automatisch mit dem vorherigen Lauf in
        diesem Tab.
      </ResultCompareNotice>
    );
  } else if (foreign) {
    body = (
      <ResultCompareNotice
        icon={<HistoryIcon />}
        title="Der letzte Lauf gehört zu einer anderen Datenbank"
      >
        Führe die Abfrage hier erneut aus, um einen neuen Vergleich zu beginnen.
      </ResultCompareNotice>
    );
  } else if (!pair || !comparison) {
    body = (
      <ResultCompareNotice icon={<HistoryIcon />} title="Noch nichts zu vergleichen">
        Führe die Abfrage erneut aus. l8db zeigt dann, was sich gegenüber dem Lauf von{" "}
        <time className="font-mono text-foreground/80">{clock(latest.at)}</time> geändert hat.
      </ResultCompareNotice>
    );
  } else if (comparison.error) {
    body = (
      <ResultCompareNotice icon={<TriangleAlertIcon />} title="Zeilen lassen sich nicht zuordnen">
        <p>{comparison.error}</p>
        {keyColumns.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-7 text-xs"
            onClick={() => setChosenKey([])}
          >
            Ganze Zeilen vergleichen
          </Button>
        )}
      </ResultCompareNotice>
    );
  } else if (comparison.changes.length === 0) {
    const columnNote = [
      comparison.columns.added.length > 0 && `neue Spalten ${comparison.columns.added.join(", ")}`,
      comparison.columns.removed.length > 0 &&
        `entfallene Spalten ${comparison.columns.removed.join(", ")}`,
    ].filter(Boolean);
    body = (
      <ResultCompareNotice
        icon={<CircleCheckIcon className="text-emerald-600 dark:text-emerald-400" />}
        title={
          sameSql(pair.baseline.sql, pair.latest.sql)
            ? "Identisch mit dem vorherigen Lauf"
            : "Die geänderte Abfrage liefert dasselbe Ergebnis"
        }
      >
        {rowsLabel(after?.rows.length ?? 0)}, alle verglichenen Werte gleich
        {comparison.keyColumns.length > 0
          ? ` (zugeordnet über ${comparison.keyColumns.join(", ")})`
          : ""}
        .
        {columnNote.length > 0 && <span className="block">Außerdem: {columnNote.join("; ")}.</span>}
      </ResultCompareNotice>
    );
  } else {
    body = (
      <>
        <ResultCompareMap
          changes={visible}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
        />
        <div className="flex min-h-0 flex-1 flex-col border-t @min-[52rem]/compare:flex-row">
          <ResultCompareList
            changes={visible}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            keyColumns={comparison.keyColumns}
            columns={columns}
            masks={masks}
          />
          <div className="h-[42%] min-h-0 shrink-0 border-t bg-card/40 @min-[52rem]/compare:h-auto @min-[52rem]/compare:w-[42%] @min-[52rem]/compare:border-t-0 @min-[52rem]/compare:border-l">
            <ResultCompareDetail
              change={selected}
              keyColumns={comparison.keyColumns}
              columns={columns}
              masks={masks}
            />
          </div>
        </div>
      </>
    );
  }

  const counts = comparison && !comparison.error ? comparison.counts : null;
  const total = comparison?.changes.length ?? 0;

  return (
    <section
      aria-label="Vergleich mit dem vorherigen Lauf"
      className="@container/compare flex h-full min-h-0 flex-col"
    >
      <div className="flex h-10 shrink-0 items-center gap-3 border-b bg-muted/30 pr-2 pl-3">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
          <GitCompareArrowsIcon className="size-3.5 text-primary" />
          Vergleich
        </span>
        {counts && (
          <span
            aria-live="polite"
            className="hidden min-w-0 items-center gap-3 truncate text-[11px] tabular-nums text-muted-foreground @min-[34rem]/compare:flex"
          >
            {KINDS.map(
              (kind) =>
                counts[kind] > 0 && (
                  <span key={kind} className="flex shrink-0 items-center gap-1.5">
                    <span className={cn("size-1.5 rounded-full", CHANGE_TONE[kind].dot)} />
                    <span className="text-foreground/90">{counts[kind]}</span>
                    {CHANGE_TONE[kind].label.toLowerCase()}
                  </span>
                ),
            )}
            <span className="shrink-0">{counts.equal} gleich</span>
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {comparison && pair && (
            <ResultCompareKeyMenu
              columns={comparison.columns.shared}
              detected={detected}
              chosen={chosenKey}
              onChange={setChosenKey}
            />
          )}
          {pair && (
            <Button
              size="sm"
              variant={runs.pinned ? "secondary" : "ghost"}
              className="h-7 gap-1.5 px-2 text-xs"
              aria-pressed={runs.pinned}
              title={
                runs.pinned
                  ? "Die Basis bleibt bei weiteren Läufen bestehen. Klicken, um immer mit dem vorherigen Lauf zu vergleichen."
                  : "Diese Basis für weitere Läufe festhalten"
              }
              onClick={() => onRunsChange((current) => ({ ...current, pinned: !current.pinned }))}
            >
              <PinIcon className={cn("size-3", runs.pinned && "fill-current")} />
              <span className="hidden @min-[44rem]/compare:inline">Basis halten</span>
            </Button>
          )}
          {actions}
          <Button
            size="icon-sm"
            variant={maximized ? "secondary" : "ghost"}
            aria-pressed={maximized}
            aria-label={maximized ? "Editor wieder einblenden" : "Vergleich vergrößern"}
            title={maximized ? "Editor wieder einblenden" : "Vergleich vergrößern"}
            onClick={onToggleMaximized}
          >
            <MorphIcon icon={maximized ? Minimize2 : Maximize2} className="size-3.5" />
          </Button>
        </div>
      </div>

      {pair && comparison && !comparison.error && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>
            Basis <time className="font-mono text-foreground/80">{clock(pair.baseline.at)}</time> ·{" "}
            {rowsLabel(pair.baseline.result.rows.length)}
          </span>
          <ArrowRightIcon aria-label="verglichen mit" className="size-3" />
          <span>
            Jetzt <time className="font-mono text-foreground/80">{clock(pair.latest.at)}</time> ·{" "}
            {rowsLabel(pair.latest.result.rows.length)}
          </span>
          {!sameSql(pair.baseline.sql, pair.latest.sql) && (
            <span
              className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              title={`SQL der Basis:\n${pair.baseline.sql}`}
            >
              Andere SQL
            </span>
          )}
          {comparison.columns.added.length + comparison.columns.removed.length > 0 && (
            <span className="truncate" title="Nur gemeinsame Spalten werden verglichen">
              Spalten{" "}
              {[
                ...comparison.columns.added.map((column) => `+${column}`),
                ...comparison.columns.removed.map((column) => `−${column}`),
              ].join(" ")}
            </span>
          )}
          {total > 0 && (
            <div className="ml-auto w-full max-w-[22rem] @min-[52rem]/compare:w-[22rem]">
              <SegmentedControl
                label="Unterschiede filtern"
                value={activeFilter}
                onChange={(next) => {
                  setFilter(next);
                  setSelectedId(null);
                }}
                options={[
                  { value: "all", label: `Alle ${total}` },
                  ...KINDS.map((kind) => ({
                    value: kind,
                    label: `${CHANGE_TONE[kind].label} ${comparison.counts[kind]}`,
                  })),
                ]}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </section>
  );
}
