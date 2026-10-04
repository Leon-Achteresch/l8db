import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  columnKey,
  effectiveRules,
  invalidRules,
  ownColumns,
  STRATEGY_LABELS,
  setRule,
  strategiesFor,
  suggestedRules,
  uncovered,
} from "@/lib/branching/masking";
import { isMasked } from "@/lib/branching/model";
import {
  branchingColumns,
  branchingLocal,
  branchingUpdate,
  type MaskRule,
  type MaskStrategy,
} from "@/lib/db";
import { cn } from "@/lib/utils";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

type Scope = "team" | "local";

export function MaskingEditor({ workspace }: { workspace: BranchingWorkspace }) {
  const overview = workspace.overview;
  const root = overview?.databases.find((entry) => entry.name === overview.root);
  const strict = isMasked(root);
  const owner = Boolean(root?.isOwner || overview?.server.superuser);
  const [scope, setScope] = useState<Scope>(owner || strict ? "team" : "local");
  const [draft, setDraft] = useState<Record<Scope, MaskRule[] | null>>({ team: null, local: null });
  const [relevant, setRelevant] = useState(true);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["branching-columns", workspace.connection.id, overview?.root],
    enabled: Boolean(root?.canConnect),
    retry: false,
    staleTime: 60_000,
    queryFn: () => branchingColumns(workspace.url(), overview?.root ?? ""),
  });
  const team = root?.marker?.masking ?? [];
  const local = overview?.policy.masking ?? [];
  if (!overview || !root) return null;
  const saved = scope === "team" ? team : local;
  const rules = draft[scope] ?? saved;
  const dirty = draft[scope] !== null;
  const editable =
    scope === "team" ? owner && !overview.readOnly && !workspace.busy : !strict && !workspace.busy;
  const columns = ownColumns(query.data ?? []);
  const errors = query.data ? invalidRules(columns, rules) : [];
  const teamKeys = new Map(team.map((rule) => [columnKey(rule), rule]));
  const byKey = new Map(rules.map((rule) => [columnKey(rule), rule]));
  const effective = effectiveRules(
    scope === "team" ? rules : team,
    strict,
    scope === "local" ? rules : local,
  );
  const open = query.data ? uncovered(columns, effective) : [];
  const needle = search.trim().toLowerCase();
  const visible = columns.filter(
    (column) =>
      (!relevant ||
        column.pii ||
        byKey.has(columnKey(column)) ||
        teamKeys.has(columnKey(column))) &&
      (!needle || columnKey(column).toLowerCase().includes(needle)),
  );
  const update = (next: MaskRule[]) => setDraft((current) => ({ ...current, [scope]: next }));
  const save = () =>
    void workspace
      .run(
        () =>
          scope === "team"
            ? branchingUpdate(workspace.url(), {
                action: "team_masking",
                database: root.name,
                rules,
              })
            : branchingLocal({
                action: "policy",
                key: overview.policyKey,
                policy: { ...overview.policy, masking: rules },
              }),
        scope === "team" ? "Team-Regeln gespeichert." : "Eigene Regeln gespeichert.",
      )
      .then((ok) => ok && setDraft((current) => ({ ...current, [scope]: null })));
  return (
    <div className="space-y-3">
      <Tabs value={scope} onValueChange={(next) => setScope(next as Scope)}>
        <TabsList>
          <TabsTrigger value="team" className="px-3 text-xs">
            Team-Regeln · {team.length}
          </TabsTrigger>
          <TabsTrigger value="local" className="px-3 text-xs" disabled={strict}>
            Eigene Regeln · {local.length}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {scope === "team"
          ? owner
            ? "Team-Regeln liegen in der Datenbank und gelten für alle. Sie haben Vorrang vor eigenen Regeln."
            : `Team-Regeln kann nur der Eigentümer (${root.owner}) ändern.`
          : "Eigene Regeln gelten nur auf diesem Rechner und ergänzen die Team-Regeln für weitere Spalten."}
        {strict && " Die Datenbank ist maskiert geschützt: es gelten ausschließlich Team-Regeln."}
      </p>
      {query.error && (
        <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </p>
      )}
      {!root.canConnect && (
        <p className="text-xs text-muted-foreground">
          Keine Verbindung zu „{root.name}“ möglich (CONNECT-Recht fehlt).
        </p>
      )}
      {query.isLoading && <Skeleton className="h-40 rounded-xl" />}
      {query.data && (
        <>
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl p-3 text-xs",
              open.length ? "bg-amber-500/10" : "bg-emerald-500/5",
            )}
          >
            <span className="min-w-0 flex-1">
              {columns.filter((column) => column.pii).length} Spalten mit Personenbezug erkannt ·{" "}
              {open.length
                ? `${open.length} ohne Regel – anonymisierte Branches werden abgelehnt`
                : "alle abgedeckt"}
            </span>
            {open.length > 0 && editable && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px]"
                onClick={() =>
                  update([...rules, ...suggestedRules(columns, effective).slice(effective.length)])
                }
              >
                <SparklesIcon className="size-3" />
                Vorschläge übernehmen
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Schema, Tabelle oder Spalte suchen"
              aria-label="Spalten durchsuchen"
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
              Nur relevante
              <Switch
                checked={relevant}
                onCheckedChange={setRelevant}
                aria-label="Nur Spalten mit Personenbezug oder Regel zeigen"
              />
            </label>
          </div>
          <ul className="max-h-[420px] space-y-0.5 overflow-y-auto overscroll-contain">
            {visible.map((column) => {
              const key = columnKey(column);
              const rule = byKey.get(key);
              const inherited = scope === "local" ? teamKeys.get(key) : undefined;
              const options = [
                { value: "", label: "Keine Regel" },
                ...strategiesFor(column).map((strategy) => ({
                  value: strategy,
                  label: STRATEGY_LABELS[strategy],
                })),
              ];
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px]">
                      <span className="text-muted-foreground">
                        {column.schema}.{column.table}.
                      </span>
                      {column.column}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {column.dataType}
                      {column.notNull ? " · NOT NULL" : ""}
                      {column.pii ? ` · ${column.pii.reason}` : ""}
                    </p>
                  </div>
                  {inherited ? (
                    <span className="w-44 shrink-0 truncate text-[11px] text-muted-foreground">
                      Team: {STRATEGY_LABELS[inherited.strategy]}
                    </span>
                  ) : (
                    <div className="flex w-44 shrink-0 flex-col gap-1">
                      <VersioningSelect
                        hideLabel
                        label={`Regel für ${key}`}
                        value={rule?.strategy ?? ""}
                        disabled={!editable}
                        onChange={(value) =>
                          update(
                            setRule(
                              rules,
                              column,
                              (value || null) as MaskStrategy | null,
                              rule?.value,
                            ),
                          )
                        }
                        options={options}
                      />
                      {rule?.strategy === "fixed" && (
                        <Input
                          value={rule.value ?? ""}
                          disabled={!editable}
                          onChange={(event) =>
                            update(setRule(rules, column, "fixed", event.target.value))
                          }
                          placeholder="Fester Wert"
                          aria-label={`Fester Wert für ${key}`}
                          className="h-7 text-[11px]"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {!visible.length && (
              <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                Keine passenden Spalten.
              </li>
            )}
          </ul>
          {errors.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-destructive/5 p-3 text-[11px] text-destructive">
              {errors.slice(0, 8).map((error) => (
                <li key={error} className="flex gap-1.5">
                  <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
                  {error}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => setDraft((current) => ({ ...current, [scope]: null }))}
              >
                Verwerfen
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!dirty || !editable || errors.length > 0}
              onClick={save}
            >
              {scope === "team" ? "Team-Regeln speichern" : "Eigene Regeln speichern"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
