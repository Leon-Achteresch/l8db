import { CheckIcon, CircleAlertIcon, CodeIcon, KeyRoundIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  commitStagedTable,
  discardStagedTable,
  isUserCancel,
  useStagedEdits,
} from "@/lib/staged-edits";
import { StagedSqlDialog } from "./staged-sql-dialog";

interface StagedChangesControlProps {
  stagedKey: string | null;
  collectBlocked: boolean;
  onCommitted: () => void;
}

export function StagedChangesControl({
  stagedKey,
  collectBlocked,
  onCommitted,
}: StagedChangesControlProps) {
  const entry = useStagedEdits((state) => (stagedKey ? state.tables[stagedKey] : undefined));
  const committing = useStagedEdits((state) =>
    stagedKey ? state.committing.includes(stagedKey) : false,
  );
  const [sqlOpen, setSqlOpen] = useState(false);
  const feature = useNewFeatureVisibility<HTMLDivElement>(
    entry ? "table.rows.staged-changes" : undefined,
  );
  if (!entry || !stagedKey) {
    return collectBlocked ? (
      <KeyRoundIcon
        role="img"
        aria-label="Ohne Schlüssel werden Änderungen sofort ausgeführt"
        className="size-3.5 text-muted-foreground"
      >
        <title>Ohne Schlüssel werden Änderungen sofort ausgeführt</title>
      </KeyRoundIcon>
    ) : null;
  }
  const count = entry.changes.length;
  const commit = async () => {
    try {
      const done = await commitStagedTable(stagedKey);
      toast.success(`${done} Änderungen übernommen.`);
      onCommitted();
    } catch (error) {
      if (!isUserCancel(error)) toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div
      ref={feature.ref}
      data-staged-changes
      className="flex items-center gap-0.5 rounded-md bg-amber-400/15 py-0.5 pr-0.5 pl-2"
    >
      {entry.error && (
        <CircleAlertIcon role="img" aria-label={entry.error} className="size-3.5 text-destructive">
          <title>{entry.error}</title>
        </CircleAlertIcon>
      )}
      <span className="mr-1 text-xs font-medium tabular-nums">
        {count === 1 ? "1 Änderung" : `${count} Änderungen`}
      </span>
      {feature.isNew && <NewBadge className="mr-1" />}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs"
        onClick={() => setSqlOpen(true)}
      >
        <CodeIcon className="size-3.5" />
        SQL ansehen
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs"
        disabled={committing}
        onClick={() => discardStagedTable(stagedKey)}
      >
        <Undo2Icon className="size-3.5" />
        Verwerfen
      </Button>
      <Button
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={committing}
        data-staged-commit
        onClick={() => void commit()}
      >
        <CheckIcon className="size-3.5" />
        Übernehmen
      </Button>
      {sqlOpen && (
        <StagedSqlDialog stagedKey={stagedKey} open={sqlOpen} onOpenChange={setSqlOpen} />
      )}
    </div>
  );
}
