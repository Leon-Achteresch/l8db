import { useNavigate } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { FileSpreadsheet, FileText, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";
import type { AiTable } from "@/lib/ai/result";
import { DEFAULT_CSV_OPTIONS, serializeCsv } from "@/lib/export";
import { useTableTabs } from "@/lib/table-tabs";
import { saveBytesToFile } from "@/lib/value-viewers/binary-file";
import { buildXlsx } from "@/lib/xlsx";
import { AiCopyAction } from "./ai-copy-action";
import { ResponseAction } from "./beui/agents/streaming-response";

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
  const fail = (error: unknown) => toast.error(`Export fehlgeschlagen: ${String(error)}`);
  return (
    <div className="flex items-center gap-0.5">
      {table && (
        <>
          <ResponseAction
            label="Als CSV speichern"
            onClick={() =>
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
          </ResponseAction>
          <ResponseAction
            label="Als Excel speichern"
            onClick={() =>
              void saveBytesToFile(
                buildXlsx({ columns: table.columns, rows: table.rows }),
                fileName(title, "xlsx"),
              )
                .then((saved) => saved && toast.success("Excel-Datei gespeichert"))
                .catch(fail)
            }
          >
            <FileSpreadsheet className="size-3.5" />
          </ResponseAction>
        </>
      )}
      {sql && (
        <>
          <AiCopyAction text={sql} label="SQL kopieren" />
          <ResponseAction
            label="In Abfrage-Tab öffnen"
            onClick={() => {
              const id = useTableTabs.getState().openQueryTabWithSql(sql, title.slice(0, 40));
              void navigate({ to: "/query/$id", params: { id } });
            }}
          >
            <SquareArrowOutUpRight className="size-3.5" />
          </ResponseAction>
        </>
      )}
    </div>
  );
}
