import { CopyIcon, FileCodeIcon } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { SqlCodeView } from "@/features/query-builder/sql-code-view";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";

interface QueryBuilderSqlPanelProps {
  sql: string;
  ready: boolean;
  className?: string;
  onOpen: () => void;
}

export function QueryBuilderSqlPanel({ sql, ready, className, onOpen }: QueryBuilderSqlPanelProps) {
  const copy = async () => {
    try {
      await copyText(sql);
      showCopiedMessage("SQL kopiert.");
    } catch {
      toast.error("SQL konnte nicht kopiert werden.");
    }
  };
  const lines = sql === "" ? 0 : sql.split("\n").length;
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-xs font-medium">SQL</span>
        {lines > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {lines} {lines === 1 ? "Zeile" : "Zeilen"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="SQL kopieren"
            disabled={!ready}
            onClick={() => void copy()}
          >
            <CopyIcon className="size-3.5" />
          </IconButton>
          <Button size="sm" className="h-7" disabled={!ready} onClick={onOpen}>
            <FileCodeIcon />
            In Abfrage öffnen
          </Button>
        </div>
      </div>
      <SqlCodeView value={sql} className="flex-1" />
    </div>
  );
}
