import { PlayIcon, SquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { isProduction } from "@/lib/environments";
import {
  compatibleConnections,
  type MultiTarget,
  multiTarget,
  targetLabel,
} from "@/lib/multi-target";
import { supports } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";

import { MultiTargetConfirmDialog } from "./multi-target-confirm-dialog";
import { MultiTargetMergedView } from "./multi-target-merged-view";
import { MultiTargetPicker } from "./multi-target-picker";
import { MultiTargetResults } from "./multi-target-results";
import type { MultiTargetRunState } from "./use-multi-target-run";

type View = "targets" | "merged";

const VIEWS = [
  { value: "targets" as const, label: "Je Ziel" },
  { value: "merged" as const, label: "Zusammengeführt" },
];

interface MultiTargetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sql: string;
  connection: SavedConnection | null;
  database: string | null;
  run: MultiTargetRunState;
}

export function MultiTargetSheet({
  open,
  onOpenChange,
  sql,
  connection,
  database,
  run,
}: MultiTargetSheetProps) {
  const allConnections = useConnectionsStore((state) => state.connections);
  const concurrency = useSettingsStore((state) => state.multiTargetConcurrency);
  const connections = useMemo(
    () => compatibleConnections(connection, allConnections),
    [connection, allConnections],
  );
  const [selected, setSelected] = useState<MultiTarget[]>([]);
  const [seeded, setSeeded] = useState<string | null>(null);
  const [view, setView] = useState<View>("targets");
  const seedKey = connection ? `${connection.id}\u0001${database ?? ""}` : null;
  if (open && seedKey && seeded !== seedKey) {
    setSeeded(seedKey);
    if (!selected.length && connection) setSelected([multiTarget(connection.id, database)]);
  }
  const ids = run.order.length ? run.order : selected.map((target) => target.id);
  const byId = useMemo(() => {
    const map = new Map<string, MultiTarget>();
    for (const target of selected) map.set(target.id, target);
    return map;
  }, [selected]);
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of new Set([...ids, ...selected.map((target) => target.id)])) {
      const [connectionId, db, schema] = id.split("\u0001");
      const target = byId.get(id) ?? multiTarget(connectionId, db || null, schema || null);
      map.set(id, targetLabel(target, allConnections));
    }
    return map;
  }, [ids, selected, byId, allConnections]);
  const items = useMemo(
    () =>
      ids.map((id) => {
        const connectionId = id.split("\u0001")[0];
        const owner = allConnections.find((entry) => entry.id === connectionId);
        return { id, label: labels.get(id) ?? id, production: isProduction(owner) };
      }),
    [ids, labels, allConnections],
  );
  const statuses = Object.values(run.runs);
  const finished = statuses.filter((entry) =>
    ["done", "error", "cancelled", "rejected"].includes(entry.status),
  ).length;
  const failed = statuses.filter((entry) => entry.status === "error").length;
  const toggle = (targets: MultiTarget[], checked: boolean) =>
    setSelected((current) => {
      const next = new Map(current.map((target) => [target.id, target]));
      for (const target of targets) {
        if (checked) next.set(target.id, target);
        else next.delete(target.id);
      }
      return [...next.values()];
    });
  const trimmedSql = sql.trim();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-[min(100vw-1rem,1280px)] data-[side=right]:sm:max-w-[1280px]">
        <SheetHeader className="border-b">
          <SheetTitle>Abfrage auf mehreren Zielen</SheetTitle>
          <SheetDescription>
            Dieselbe Anweisung auf mehreren Datenbanken, Schemas oder Verbindungen derselben
            Datenbankfamilie ausführen. Höchstens {concurrency} Ziele laufen gleichzeitig.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1">
          <MultiTargetPicker
            connections={connections}
            activeId={connection?.id ?? null}
            selected={selected}
            onToggle={toggle}
            onReplace={setSelected}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <Button
                size="sm"
                className="h-7 gap-1.5 px-3 text-xs"
                disabled={run.running || !trimmedSql || !selected.length}
                onClick={() => run.start(sql, selected)}
              >
                <PlayIcon className="size-3" />
                Auf {selected.length} Zielen ausführen
              </Button>
              {run.running && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={run.cancelAll}
                >
                  <SquareIcon className="size-3" />
                  Alle abbrechen
                </Button>
              )}
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {ids.length > 0 && statuses.length > 0
                  ? `${finished} von ${ids.length} fertig${failed ? `, ${failed} Fehler` : ""}${
                      run.elapsedMs !== null
                        ? `, ${run.elapsedMs.toLocaleString("de-DE")} ms gesamt`
                        : ""
                    }`
                  : ""}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <SegmentedControl
                  value={view}
                  onChange={setView}
                  options={VIEWS}
                  label="Ergebnisansicht"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={run.running || !run.order.length}
                  onClick={run.clear}
                >
                  Leeren
                </Button>
              </div>
            </div>
            <p
              className="truncate border-b px-3 py-1 font-mono text-[11px] text-muted-foreground"
              title={run.lastSql ?? trimmedSql}
            >
              {run.lastSql ?? (trimmedSql || "Kein SQL im Editor.")}
            </p>
            {view === "merged" && run.order.length > 0 ? (
              <MultiTargetMergedView
                items={items}
                runs={run.runs}
                kind={connection?.kind}
                sql={run.lastSql}
              />
            ) : (
              <MultiTargetResults
                items={items}
                runs={run.runs}
                kind={connection?.kind}
                onCancel={run.cancel}
              />
            )}
          </div>
        </div>
        <MultiTargetConfirmDialog
          pending={run.pending}
          labels={labels}
          canCount={supports(connection, "dml_preview")}
          onCount={() => run.countAffected(connection)}
          onAnswer={run.resolveConfirmation}
        />
      </SheetContent>
    </Sheet>
  );
}
