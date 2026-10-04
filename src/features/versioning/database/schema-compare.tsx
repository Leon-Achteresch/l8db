import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRightIcon, CircleAlertIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { DefinitionDiffEditor, type DiffStats } from "@/features/compare/definition-diff-editor";
import { compareChoices, snapshotsFor } from "@/lib/branching/model";
import { branchingSchema } from "@/lib/db";
import { VersioningIconButton } from "../versioning-icon-button";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

export function SchemaCompare({
  workspace,
  preset,
}: {
  workspace: BranchingWorkspace;
  preset: [string, string] | null;
}) {
  const overview = workspace.overview;
  const choices = overview ? compareChoices(overview.databases, overview.snapshots) : [];
  const latest = overview ? snapshotsFor(overview.snapshots, workspace.database)[0] : undefined;
  const [left, setLeft] = useState(
    preset?.[0] ?? (latest ? `snapshot:${latest.id}` : `live:${overview?.root ?? ""}`),
  );
  const [right, setRight] = useState(preset?.[1] ?? `live:${workspace.database}`);
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const [stats, setStats] = useState<DiffStats | null>(null);
  useEffect(() => {
    if (!preset) return;
    setLeft(preset[0]);
    setRight(preset[1]);
  }, [preset]);
  const leftChoice = choices.find((choice) => choice.key === left);
  const rightChoice = choices.find((choice) => choice.key === right);
  const schema = (key: string, choice: typeof leftChoice) => ({
    queryKey: ["branching-schema", workspace.connection.id, key, workspace.toolPaths],
    enabled: Boolean(choice),
    retry: false,
    staleTime: key.startsWith("snapshot:") ? Number.POSITIVE_INFINITY : 30_000,
    queryFn: () =>
      choice
        ? branchingSchema(workspace.url(), choice.source, workspace.toolPaths)
        : Promise.resolve(""),
  });
  const original = useQuery(schema(left, leftChoice));
  const modified = useQuery(schema(right, rightChoice));
  const error = original.error ?? modified.error;
  const loaded = original.data !== undefined && modified.data !== undefined;
  const options = choices.map((choice) => ({ value: choice.key, label: choice.label }));
  return (
    <section className="space-y-3" aria-label="Schema vergleichen">
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1.5 text-xs">
          <span className="font-medium">Basis</span>
          <VersioningSelect
            hideLabel
            label="Basis"
            value={left}
            onChange={setLeft}
            options={options}
          />
        </label>
        <VersioningIconButton
          icon={ArrowLeftRightIcon}
          label="Seiten tauschen"
          onClick={() => {
            setLeft(right);
            setRight(left);
          }}
        />
        <label className="min-w-0 flex-1 space-y-1.5 text-xs">
          <span className="font-medium">Vergleich</span>
          <VersioningSelect
            hideLabel
            label="Vergleich"
            value={right}
            onChange={setRight}
            options={options}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {!loaded
            ? "Schema wird gelesen…"
            : original.data === modified.data
              ? "Die Schemata sind identisch."
              : stats
                ? `${stats.changes} ${stats.changes === 1 ? "Abschnitt" : "Abschnitte"} · +${stats.added} −${stats.removed} Zeilen`
                : ""}
        </span>
        <label className="flex items-center gap-2">
          Nur Unterschiede
          <Switch
            checked={onlyDifferences}
            onCheckedChange={setOnlyDifferences}
            aria-label="Nur Unterschiede anzeigen"
          />
        </label>
        <VersioningIconButton
          icon={RefreshCwIcon}
          label="Aktuelle Stände neu lesen"
          onClick={() => {
            void original.refetch();
            void modified.refetch();
          }}
        />
      </div>
      {error && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-line break-words">
            {error instanceof Error ? error.message : String(error)}
          </span>
        </p>
      )}
      {loaded ? (
        <div className="h-[480px] min-w-0 overflow-hidden rounded-lg bg-muted/20">
          <DefinitionDiffEditor
            original={original.data ?? ""}
            modified={modified.data ?? ""}
            onlyDifferences={onlyDifferences}
            onStats={setStats}
            readOnly
          />
        </div>
      ) : (
        !error && <Skeleton className="h-[480px] rounded-lg" />
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Verglichen wird die normalisierte DDL ohne Eigentümer und Rechte. Gesicherte Schemata
        stammen aus dem verschlüsselten Tresor und werden vor dem Anzeigen geprüft.
      </p>
    </section>
  );
}
