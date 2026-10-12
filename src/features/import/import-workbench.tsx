import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  detectImportFormat,
  IMPORT_FILE_EXTENSIONS,
  pickImportFile,
  readImportFile,
} from "@/lib/import-file";
import { EMPTY_SQL_IMPORT, useImportWorkspace } from "@/lib/import-workspace";
import { supports } from "@/lib/providers";
import { sqlFileTitle } from "@/lib/sql-file";
import { CsvImportPanel } from "./csv-import-panel";
import { useCsvImport } from "./csv-import-panel/use-csv-import";
import { ImportFileList } from "./import-file-list";
import { ImportSteps } from "./import-steps";
import { SqlImportPanel } from "./sql-import-panel";

const SQL_MODE_LABELS = {
  "existing-transaction": "Offene Transaktion",
  "new-transaction": "Transaktion, danach prüfen",
  autocommit: "Autocommit je Statement",
} as const;

const DATA_EXTENSIONS = Object.values(IMPORT_FILE_EXTENSIONS).flat();

export function ImportWorkbench({ tab }: { tab?: "csv" }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const csvEnabled = supports(connection, "csv_import");
  const csv = useCsvImport();
  const sqlKey = JSON.stringify([connection?.id, database]);
  const sqlDraft = useImportWorkspace((state) => state.sql[sqlKey] ?? EMPTY_SQL_IMPORT);
  const [selected, setSelected] = useState<"data" | "sql">(() =>
    csvEnabled && (tab === "csv" || !sqlDraft.fileName) ? "data" : "sql",
  );
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const pane = csvEnabled ? selected : "sql";
  const summary: [string, string][] = [
    [
      "Ziel",
      [connection?.name, database, csv.schema, pane === "data" ? csv.targetTable : null]
        .filter(Boolean)
        .join(" · "),
    ],
    [
      "Ausführung",
      pane === "data"
        ? csv.transactional
          ? "Eine Transaktion"
          : "Ohne Transaktion"
        : SQL_MODE_LABELS[sqlDraft.mode],
    ],
  ];
  if (pane === "data" && csv.parsed)
    summary.push([
      "Zeilen",
      csv.parsed.totalRows === null
        ? `mehr als ${csv.rowCount.toLocaleString("de-DE")}`
        : csv.parsed.totalRows.toLocaleString("de-DE"),
    ]);

  const loadSql = async (path: string) => {
    const file = await readImportFile(path);
    useImportWorkspace.getState().patchSql(sqlKey, {
      fileName: file.name,
      filePath: file.path,
      sql: file.text,
      entries: null,
      jobId: null,
    });
    setSelected("sql");
  };

  const guard = async (action: () => Promise<void>) => {
    setPickError(null);
    try {
      await action();
    } catch (failure) {
      setPickError(String(failure));
    }
  };

  const pickAny = () =>
    guard(async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: csvEnabled
          ? [
              { name: "Unterstützte Dateien", extensions: [...DATA_EXTENSIONS, "sql"] },
              { name: "Daten", extensions: DATA_EXTENSIONS },
              { name: "SQL-Skript", extensions: ["sql"] },
            ]
          : [{ name: "SQL-Skript", extensions: ["sql", "txt"] }],
      });
      if (typeof path !== "string") return;
      if (!csvEnabled || path.toLowerCase().endsWith(".sql")) return loadSql(path);
      await csv.handlePickFile({
        path,
        name: sqlFileTitle(path),
        format: detectImportFormat(path),
      });
      setSelected("data");
    });

  const pickSql = () =>
    guard(async () => {
      const file = await pickImportFile("sql");
      if (file) await loadSql(file.path);
    });

  const pickData = () =>
    guard(async () => {
      await csv.handlePickFile();
      setSelected("data");
    });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        {pane === "data" ? (
          <ImportSteps csv={csv} />
        ) : (
          <span className="text-xs text-muted-foreground">SQL-Skript ausführen</span>
        )}
        <div ref={setActions} className="ml-auto flex items-center gap-2" />
      </div>
      <div className="flex min-h-0 flex-1">
        <ImportFileList
          csv={csvEnabled ? csv : null}
          sql={sqlDraft}
          selected={pane}
          error={pickError}
          summary={summary}
          onSelect={setSelected}
          onPickAny={() => void pickAny()}
          onPickData={() => void pickData()}
          onPickSql={() => void pickSql()}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {pane === "data" ? (
            <CsvImportPanel csv={csv} actions={actions} onPickFile={() => void pickData()} />
          ) : (
            <SqlImportPanel actions={actions} onPickFile={() => void pickSql()} />
          )}
        </div>
      </div>
    </div>
  );
}
