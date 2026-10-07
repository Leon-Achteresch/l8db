import { useNavigate } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Copy, Download, FileSpreadsheet, FileText, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AiTable } from "@/lib/ai/result";
import { DEFAULT_CSV_OPTIONS, serializeCsv } from "@/lib/export";
import { useTableTabs } from "@/lib/table-tabs";
import { saveBytesToFile } from "@/lib/value-viewers/binary-file";
import { showCopiedMessage } from "@/lib/workspace-status";
import { buildXlsx } from "@/lib/xlsx";

function fileName(title: string, extension: string) {
  const base = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "ki-ergebnis"}.${extension}`;
}

export function AiResultActions({
  table,
  sql,
  title,
}: {
  table?: AiTable | null;
  sql?: string;
  title: string;
}) {
  const navigate = useNavigate();
  if (!table && !sql) return null;
  const fail = (error: unknown) => toast.error(`Export fehlgeschlagen: ${String(error)}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${title} exportieren`}
          title="Exportieren"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <Download className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-xl text-xs">
        {table && (
          <>
            <DropdownMenuItem
              onSelect={() =>
                void save({
                  defaultPath: fileName(title, "csv"),
                  filters: [{ name: "CSV", extensions: ["csv"] }],
                })
                  .then(async (path) => {
                    if (!path) return;
                    await writeTextFile(
                      path,
                      serializeCsv(table.columns, table.rows, DEFAULT_CSV_OPTIONS),
                    );
                    toast.success("CSV gespeichert");
                  })
                  .catch(fail)
              }
            >
              <FileText className="size-3.5" />
              Als CSV speichern
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void saveBytesToFile(
                  buildXlsx({ columns: table.columns, rows: table.rows }),
                  fileName(title, "xlsx"),
                )
                  .then((saved) => saved && toast.success("Excel-Datei gespeichert"))
                  .catch(fail)
              }
            >
              <FileSpreadsheet className="size-3.5" />
              Als Excel speichern
            </DropdownMenuItem>
          </>
        )}
        {table && sql && <DropdownMenuSeparator />}
        {sql && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard?.writeText(sql);
                showCopiedMessage("SQL kopiert");
              }}
            >
              <Copy className="size-3.5" />
              SQL kopieren
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const id = useTableTabs.getState().openQueryTabWithSql(sql, title.slice(0, 40));
                void navigate({ to: "/query/$id", params: { id } });
              }}
            >
              <SquareArrowOutUpRight className="size-3.5" />
              In Abfrage-Tab öffnen
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
