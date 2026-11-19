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
          title={`${file.path}\n${file.columns.length} Spalten`}
          className="flex max-w-full items-center gap-2 rounded-xl bg-muted/70 py-1 pr-1 pl-1 text-2xs"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-success/15 text-success">
            <FileSpreadsheet className="size-3.5" />
          </span>
          <span className="min-w-0 truncate font-medium">{file.name}</span>
          <span className="shrink-0 text-muted-foreground">
            {file.totalRows !== null
              ? `${file.totalRows.toLocaleString("de-DE")} Zeilen`
              : `${file.columns.length} Spalten`}
          </span>
          {onRemove && (
            <button
              type="button"
              aria-label={`${file.name} entfernen`}
              onClick={() => onRemove(file.path)}
              className="grid size-5 place-items-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
