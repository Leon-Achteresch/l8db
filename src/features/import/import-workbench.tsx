import { open } from "@tauri-apps/plugin-dialog";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  detectImportFormat,
  IMPORT_FILE_EXTENSIONS,
  pickDataFile,
  pickImportFilePath,
  readImportFile,
} from "@/lib/import-file";
import { EMPTY_SQL_IMPORT, selectSqlImportFile, useImportWorkspace } from "@/lib/import-workspace";
import { capabilitiesFor, supports } from "@/lib/providers";
import { sqlFileTitle } from "@/lib/sql-file";
import { tabStateKey, useTabState } from "@/lib/tab-state";
import { findTransaction, useTransactionStore } from "@/lib/transactions";
import { CsvImportPanel } from "./csv-import-panel";
import { useCsvImport } from "./csv-import-panel/use-csv-import";
import { ImportFileList } from "./import-file-list";
import { ImportSteps } from "./import-steps";
import { SqlImportPanel } from "./sql-import-panel";
import { sqlImportSummary } from "./sql-import-summary";

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
  const scripts = !csvEnabled || capabilitiesFor(connection?.kind).query_language === "sql";
  const csv = useCsvImport();
  const sqlKey = JSON.stringify([connection?.id, database]);
  const sqlDraft = useImportWorkspace((state) => state.sql[sqlKey] ?? EMPTY_SQL_IMPORT);
  const script = useMemo(
    () => sqlImportSummary(sqlDraft.sql, connection?.kind),
    [sqlDraft.sql, connection?.kind],
  );
  const existing = useTransactionStore((state) =>
    Boolean(
      connection && findTransaction(state.transactions, connection.id, database, { type: "query" }),
    ),
  );
  const mode = existing
    ? "existing-transaction"
    : supports(connection, "transactions")
      ? sqlDraft.mode === "existing-transaction"
        ? "new-transaction"
        : sqlDraft.mode
      : "autocommit";
  const sqlSelection = useRef<number | null>(0);
  useLayoutEffect(() => {
    sqlSelection.current = 0;
    return () => {
      sqlSelection.current = null;
    };
  }, []);
  const [selected, setSelected] = useTabState<"data" | "sql">(
    tabStateKey(`import:${sqlKey}`, "pane"),
    csvEnabled && (tab === "csv" || !sqlDraft.fileName) ? "data" : "sql",
  );
  useLayoutEffect(() => {
    if (tab === "csv" && csvEnabled) setSelected("data");
  }, [tab, csvEnabled, setSelected]);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const pane = csvEnabled ? (scripts ? selected : "data") : "sql";
  const summary: [string, string][] = [
    [
      "Ziel",
      [
        connection?.name,
        database,
        csv.schema === database ? null : csv.schema,
        pane === "data" ? csv.targetTable : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    [
      "Ausführung",
      pane === "data"
        ? csv.transactional
          ? "Eine Transaktion"
          : "Ohne Transaktion"
        : SQL_MODE_LABELS[mode],
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
    if (sqlSelection.current === null) return;
    const selection = ++sqlSelection.current;
    let file: Awaited<ReturnType<typeof readImportFile>>;
    try {
      file = await readImportFile(path);
    } catch (error) {
      if (selection === sqlSelection.current) throw error;
      return;
    }
    if (selection !== sqlSelection.current) return;
    selectSqlImportFile(sqlKey, file);
    setSelected("sql");
  };

  const loadData = async (file: NonNullable<Awaited<ReturnType<typeof pickDataFile>>>) => {
    if (sqlSelection.current === null) return;
    sqlSelection.current++;
    setSelected("data");
    await csv.handlePickFile(file);
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
        filters: !scripts
          ? [{ name: "Daten", extensions: DATA_EXTENSIONS }]
          : csvEnabled
            ? [
                { name: "Unterstützte Dateien", extensions: [...DATA_EXTENSIONS, "sql"] },
                { name: "Daten", extensions: DATA_EXTENSIONS },
                { name: "SQL-Skript", extensions: ["sql"] },
              ]
            : [{ name: "SQL-Skript", extensions: ["sql", "txt"] }],
      });
      if (typeof path !== "string") return;
      if (!csvEnabled || (scripts && path.toLowerCase().endsWith(".sql"))) return loadSql(path);
      await loadData({
        path,
        name: sqlFileTitle(path),
        format: detectImportFormat(path),
      });
    });

  const pickSql = () =>
    guard(async () => {
      const path = await pickImportFilePath("sql");
      if (path) await loadSql(path);
    });

  const pickData = () =>
    guard(async () => {
      const file = await pickDataFile();
      if (file) await loadData(file);
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
          script={script}
          scripts={scripts}
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
            <SqlImportPanel
              actions={actions}
              onPickFile={() => void pickSql()}
              script={script}
              mode={mode}
            />
          )}
        </div>
      </div>
    </div>
  );
}
