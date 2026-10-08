import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBytes } from "@/lib/backup";
import type { SchemaSize, TransferPlan } from "@/lib/db";

export function TransferSummary({
  plan,
  selected,
  sizes,
  crossFamily,
  foldNames,
  onFoldNames,
  onShowPlan,
}: {
  plan: TransferPlan | null;
  selected: string[];
  sizes: Record<string, SchemaSize>;
  crossFamily: boolean;
  foldNames: boolean;
  onFoldNames: (value: boolean) => void;
  onShowPlan: (tab: string) => void;
}) {
  const known = selected.map((schema) => sizes[schema]).filter(Boolean);
  const bytes = known.reduce((sum, entry) => sum + entry.size_bytes, 0);
  const tables = plan
    ? plan.tables.length
    : known.reduce((sum, entry) => sum + entry.table_count, 0);
  const converted = plan
    ? plan.tables.reduce(
        (sum, table) =>
          sum +
          table.columns.filter(
            (column) => column.sourceType.toLowerCase() !== column.targetType.toLowerCase(),
          ).length,
        0,
      )
    : 0;
  const largest = [...known].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 4);
  const max = largest[0]?.size_bytes ?? 0;
  const conflicts = plan?.conflicts ?? [];

  return (
    <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-xs font-semibold">Auswahl</h3>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            [selected.length, "Schemas"],
            [tables, "Tabellen"],
            [known.length ? formatBytes(bytes) : "–", "Größe"],
          ].map(([value, label]) => (
            <div key={label} className="grid">
              <span className="text-xl font-semibold tabular-nums">{value}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
        <dl className="mt-3 grid divide-y text-xs">
          <div className="flex justify-between py-2">
            <dt className="text-muted-foreground">Ausführung</dt>
            <dd className="font-medium">
              {plan ? (plan.atomic ? "Eine Zieltransaktion" : "Mit Aufräumen bei Fehler") : "–"}
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-muted-foreground">Bereits vorhanden</dt>
            <dd
              className={
                conflicts.length
                  ? "font-medium text-amber-700 tabular-nums dark:text-amber-400"
                  : "font-medium tabular-nums"
              }
            >
              {plan ? `${conflicts.length} Objekte` : "–"}
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-muted-foreground">Typen umgewandelt</dt>
            <dd className="font-medium tabular-nums">
              {plan ? (plan.native ? "Keine" : `${converted} Spalten`) : "–"}
            </dd>
          </div>
          {plan && plan.manual.length + plan.warnings.length > 0 && (
            <div className="flex justify-between py-2">
              <dt className="text-muted-foreground">Hinweise</dt>
              <dd>
                <button
                  type="button"
                  className="flex items-center gap-1 font-medium text-amber-700 hover:underline dark:text-amber-400"
                  onClick={() => onShowPlan(plan.manual.length ? "manual" : "warnings")}
                >
                  <TriangleAlertIcon className="size-3.5" />
                  {plan.manual.length + plan.warnings.length}
                </button>
              </dd>
            </div>
          )}
        </dl>
      </section>

      {conflicts.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
          <p className="font-medium text-amber-700 dark:text-amber-400">
            Im Ziel existieren bereits {conflicts.length} Objekte. Anderes Zielschema wählen oder
            die Objekte entfernen.
          </p>
          <p className="mt-1.5 font-mono break-all text-muted-foreground">
            {conflicts.slice(0, 30).join(", ")}
          </p>
        </section>
      )}

      {largest.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <h3 className="text-xs font-semibold">Größte Schemas</h3>
          <ul className="mt-3 grid gap-3">
            {largest.map((entry) => (
              <li key={entry.schema} className="grid gap-1">
                <span className="flex justify-between text-xs">
                  <span className="font-mono">{entry.schema}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatBytes(entry.size_bytes)}
                  </span>
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${max ? Math.max(2, (entry.size_bytes / max) * 100) : 0}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {crossFamily && (
        <Collapsible className="group/options rounded-xl border bg-card">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs">
            <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]/options:rotate-90" />
            <span className="font-semibold">Optionen</span>
            <span className="truncate text-muted-foreground">
              {foldNames ? "Namen angepasst" : "Namen unverändert"}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex items-center gap-2 px-4 pb-3">
            <Switch
              id="transfer-fold"
              size="sm"
              checked={foldNames}
              onCheckedChange={onFoldNames}
            />
            <Label htmlFor="transfer-fold" className="text-xs font-normal">
              Namen an die Konvention des Ziels anpassen
            </Label>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
