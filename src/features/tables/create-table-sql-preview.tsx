import { ChevronDownIcon, CopyIcon, FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { SqlCodeView } from "@/features/query-builder/sql-code-view";
import { cn } from "@/lib/utils";

interface CreateTableSqlPreviewProps {
  ddl: string;
  message: string;
  error: boolean;
  onCopy: () => void;
  onOpenInEditor: () => void;
}

export function CreateTableSqlPreview({
  ddl,
  message,
  error,
  onCopy,
  onOpenInEditor,
}: CreateTableSqlPreviewProps) {
  const [open, setOpen] = useState(true);
  const lines = ddl ? ddl.split("\n").length : 0;
  return (
    <div className={cn("flex shrink-0 flex-col border-t", open && "h-[34%] min-h-36")}>
      <div className="flex h-9 shrink-0 items-center gap-2 px-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium hover:bg-muted"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDownIcon className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          SQL-Vorschau
        </button>
        {lines > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {lines} {lines === 1 ? "Zeile" : "Zeilen"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={!ddl}
            onClick={onOpenInEditor}
          >
            <FileCodeIcon className="size-3.5" />
            Im Editor öffnen
          </Button>
          <IconButton
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="SQL kopieren"
            disabled={!ddl}
            onClick={onCopy}
          >
            <CopyIcon className="size-3.5" />
          </IconButton>
        </div>
      </div>
      {open &&
        (ddl ? (
          <SqlCodeView value={ddl} className="flex-1 border-t" />
        ) : (
          <p
            className={cn(
              "border-t px-3 py-3 text-xs",
              error ? "font-mono text-destructive" : "text-muted-foreground",
            )}
          >
            {message}
          </p>
        ))}
    </div>
  );
}
