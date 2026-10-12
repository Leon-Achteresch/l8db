import { useNavigate } from "@tanstack/react-router";
import { SquareTerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { DefinitionDiffEditor } from "@/features/compare/definition-diff-editor";
import { COMPARE_OBJECT_LABELS } from "@/lib/compare-types";
import { useDbSelectionStore } from "@/lib/db-selection";
import { activateConnectionWithToast } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { databaseText, repositoryText } from "@/lib/versioning/drift";
import type { DatabaseDrift } from "./use-database-drift";
import type { VersioningWorkspace } from "./use-versioning";

const STATUS = {
  changed: "In der Datenbank geändert",
  added: "Neu in der Datenbank",
  removed: "In der Datenbank entfernt",
};

export function VersioningDriftDiff({
  workspace,
  drift,
}: {
  workspace: VersioningWorkspace;
  drift: DatabaseDrift;
}) {
  const navigate = useNavigate();
  const entry = drift.entries?.find((item) => item.object.id === drift.focus);
  if (!entry) return null;
  const { selection } = entry.object;
  const openInEditor = () =>
    void workspace.run(async () => {
      const connection = drift.connection;
      if (!connection || !(await activateConnectionWithToast(connection.id))) return;
      if (drift.source.database)
        useDbSelectionStore.getState().setDatabase(connection.id, drift.source.database);
      const id = useTableTabs
        .getState()
        .openQueryTabWithSql(repositoryText(entry), `${selection.objectName} · Repository`);
      void navigate({ to: "/query/$id", params: { id } });
    });
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <CompareObjectIcon type={selection.objectType} className="size-3.5" />
        <h2 className="min-w-0 truncate font-mono text-xs font-medium">
          {selection.schema}.{selection.objectName}
        </h2>
        <span
          className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground"
          title={`Repository ↔ ${drift.scope}`}
        >
          {COMPARE_OBJECT_LABELS[selection.objectType]} · {STATUS[entry.status]}
        </span>
        <span className="flex-1" />
        {entry.status !== "added" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 text-[11px]"
            onClick={openInEditor}
          >
            <SquareTerminalIcon className="size-3.5" />
            Repository-Stand im Editor
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <DefinitionDiffEditor
          original={repositoryText(entry)}
          modified={databaseText(entry)}
          onlyDifferences={false}
          readOnly
        />
      </div>
    </div>
  );
}
