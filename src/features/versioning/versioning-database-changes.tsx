import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownToLineIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  RefreshCwIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { CompareSidePicker } from "@/features/compare/compare-side-picker";
import { DefinitionDiffEditor } from "@/features/compare/definition-diff-editor";
import {
  COMPARE_OBJECT_LABELS,
  type CompareSideSelection,
  EMPTY_COMPARE_SIDE,
} from "@/lib/compare-types";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { activateConnectionWithToast } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import {
  type DriftEntry,
  type DriftStatus,
  databaseText,
  repositoryText,
  saveDrift,
  scanDrift,
} from "@/lib/versioning/drift";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPopover } from "./versioning-popover";

const STATUS: Record<DriftStatus, { label: string; className: string }> = {
  changed: { label: "Abweichend", className: "text-amber-600 dark:text-amber-400" },
  added: { label: "Neu in DB", className: "text-emerald-600 dark:text-emerald-400" },
  removed: { label: "Fehlt in DB", className: "text-destructive" },
};

const sourceKey = (projectId: string) => `l8db.versioning.source.${projectId}`;

export function VersioningDatabaseChanges({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, project, projectText, run, refresh } = workspace;
  const navigate = useNavigate();
  const connections = useConnectionsStore((state) => state.connections);
  const active = useActiveConnection();
  const [source, setSourceState] = useState<CompareSideSelection>(() => {
    const stored = project && localStorage.getItem(sourceKey(project.id));
    if (stored)
      try {
        return JSON.parse(stored) as CompareSideSelection;
      } catch {
        return EMPTY_COMPARE_SIDE;
      }
    return active?.kind === project?.kind
      ? { ...EMPTY_COMPARE_SIDE, connectionId: active?.id ?? null }
      : EMPTY_COMPARE_SIDE;
  });
  const [entries, setEntries] = useState<DriftEntry[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  if (!project) return null;
  const connection = connections.find((item) => item.id === source.connectionId) ?? null;
  const mismatch = connection && connection.kind !== project.kind;
  const ready = Boolean(connection && !mismatch && source.schema);
  const setSource = (next: CompareSideSelection) => {
    const scope = { ...next, objectName: null, objectOid: null };
    setSourceState(scope);
    localStorage.setItem(sourceKey(project.id), JSON.stringify(scope));
    setEntries(null);
  };
  const scan = () =>
    run(async () => {
      if (!connection || mismatch || !source.schema)
        throw new Error("Eine passende Entwicklungsdatenbank mit Schema verknüpfen.");
      if (workspace.dirty)
        throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
      const result = await scanDrift(repo, project, connection, source, (name) =>
        workspace.setMessage(`Datenbank lesen: ${name}`),
      );
      setEntries(result);
      setSelected(result.map((entry) => entry.object.id));
      setFocus(result[0]?.object.id ?? null);
      workspace.setMessage(
        result.length
          ? `${result.length} Unterschiede zwischen Datenbank und Repository`
          : "Datenbank und Repository sind identisch",
      );
    });
  const save = () =>
    run(async () => {
      const chosen = (entries ?? []).filter((entry) => selected.includes(entry.object.id));
      if (!chosen.length) throw new Error("Mindestens ein Objekt auswählen.");
      await saveDrift(repo, project, projectText, chosen);
      const ids = new Set(chosen.map((entry) => entry.object.id));
      setEntries((items) => items?.filter((entry) => !ids.has(entry.object.id)) ?? null);
      setSelected([]);
      setFocus(null);
      await refresh();
    }, "Datenbankstand ins Repository übernommen. Jetzt prüfen und committen.");
  const openInEditor = (entry: DriftEntry) =>
    run(async () => {
      if (!connection || !(await activateConnectionWithToast(connection.id))) return;
      if (source.database)
        useDbSelectionStore.getState().setDatabase(connection.id, source.database);
      const id = useTableTabs
        .getState()
        .openQueryTabWithSql(
          repositoryText(entry),
          `${entry.object.selection.objectName} · Repository`,
        );
      void navigate({ to: "/query/$id", params: { id } });
    });
  const current = entries?.find((entry) => entry.object.id === focus) ?? null;
  const scope = connection
    ? [connection.name, source.database, source.schema].filter(Boolean).join(" · ")
    : "Keine Datenbank verknüpft";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold">Entwicklungsdatenbank</h2>
          <p title={scope} className="mt-1 truncate text-[11px] text-muted-foreground">
            {mismatch ? `${connection?.name} passt nicht zu ${project.kind}` : scope}
          </p>
        </div>
        <VersioningPopover
          icon={DatabaseIcon}
          label="Datenbank verknüpfen"
          disabled={workspace.busy}
        >
          <CompareSidePicker
            title="Entwicklungsdatenbank"
            value={source}
            onChange={setSource}
            schemaOnly
            className="border-0 bg-transparent p-0"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Die Verknüpfung gilt nur auf diesem Rechner. Verglichen werden Definitionen, keine
            Datenzeilen.
          </p>
        </VersioningPopover>
        <Button size="sm" variant="outline" disabled={!ready} onClick={() => void scan()}>
          <RefreshCwIcon className="size-3.5" />
          Vergleichen
        </Button>
      </div>
      {entries?.length === 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <CheckCircle2Icon className="size-3.5 text-emerald-500" />
          Datenbank und Repository sind identisch.
        </p>
      )}
      {!entries && ready && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Vergleiche die Datenbank mit dem Repository, um Änderungen zu übernehmen.
        </p>
      )}
      {Boolean(entries?.length) && (
        <>
          <div className="flex items-center gap-2 text-[11px]">
            <label className="flex flex-1 items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5"
                checked={selected.length === entries?.length}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? (entries ?? []).map((entry) => entry.object.id) : [],
                  )
                }
              />
              {selected.length} von {entries?.length} ausgewählt
            </label>
            <Button size="sm" disabled={!selected.length} onClick={() => void save()}>
              <ArrowDownToLineIcon className="size-3.5" />
              Ins Repository übernehmen
            </Button>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {entries?.map((entry) => {
              const { id, selection } = entry.object;
              return (
                <div
                  key={id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40",
                    focus === id && "bg-muted/50",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Übernehmen: ${selection.objectName}`}
                    className="size-3.5 shrink-0"
                    checked={selected.includes(id)}
                    onChange={(event) =>
                      setSelected((items) =>
                        event.target.checked ? [...items, id] : items.filter((item) => item !== id),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setFocus(id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <CompareObjectIcon type={selection.objectType} />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {selection.objectName}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {COMPARE_OBJECT_LABELS[selection.objectType]}
                      </span>
                    </span>
                    <span className={cn("text-[10px] font-medium", STATUS[entry.status].className)}>
                      {STATUS[entry.status].label}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {current && (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex-1">Links Repository · rechts Datenbank</span>
            {current.status !== "added" && (
              <Button size="sm" variant="ghost" onClick={() => void openInEditor(current)}>
                <SquareTerminalIcon className="size-3.5" />
                Repository-Stand im Editor
              </Button>
            )}
          </div>
          <div className="h-[280px] min-w-0 overflow-hidden rounded-lg bg-muted/20">
            <DefinitionDiffEditor
              original={repositoryText(current)}
              modified={databaseText(current)}
              onlyDifferences={false}
              readOnly
            />
          </div>
        </div>
      )}
    </div>
  );
}
