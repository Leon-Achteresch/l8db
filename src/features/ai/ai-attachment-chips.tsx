import { FileSpreadsheet, X } from "lucide-react";
import type { AiAttachment } from "@/lib/db/ai";

export function AiAttachmentChips({
  files,
  onRemove,
}: {
  files: AiAttachment[];
  onRemove?: (path: string) => void;
}) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Angehängte Dateien">
      {files.map((file) => (
        <li
          key={file.path}
          title={file.path}
          className="flex max-w-full items-center gap-1.5 rounded-lg border bg-background py-1 pr-1 pl-2 text-[11px]"
        >
          <FileSpreadsheet className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium">{file.name}</span>
          <span className="shrink-0 text-muted-foreground">
            {file.columns.length} Spalten
            {file.totalRows !== null ? ` · ${file.totalRows.toLocaleString("de-DE")} Zeilen` : ""}
          </span>
          {onRemove && (
            <button
              type="button"
              aria-label={`${file.name} entfernen`}
              onClick={() => onRemove(file.path)}
              className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
