import {
  EllipsisIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  UploadCloudIcon,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SqlImportDraft } from "@/lib/import-workspace";
import { splitSqlStatements } from "@/lib/sql-statements";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import type { CsvImportState } from "./csv-import-panel/use-csv-import";

const FORMATS = ["CSV", "XLSX", "JSON", "NDJSON", "Parquet", "SQL"];

function badge(tone: "ok" | "warn" | "error" | "info" | "muted", children: ReactNode) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        tone === "ok" && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
        tone === "warn" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        tone === "error" && "bg-destructive/12 text-destructive",
        tone === "info" && "bg-primary/12 text-primary",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function ImportFileList({
  csv,
  sql,
  selected,
  error,
  summary,
  onSelect,
  onPickAny,
  onPickData,
  onPickSql,
}: {
  csv: CsvImportState | null;
  sql: SqlImportDraft;
  selected: "data" | "sql";
  error: string | null;
  summary: [string, string][];
  onSelect: (value: "data" | "sql") => void;
  onPickAny: () => void;
  onPickData: () => void;
  onPickSql: () => void;
}) {
  const sqlTask = useTasksStore((state) => state.tasks.find((task) => task.id === sql.jobId));
  const statements = sql.sql ? splitSqlStatements(sql.sql).statements.length : null;
  const sqlRunning = Boolean(sqlTask && isTaskActive(sqlTask));
  const sqlFailed = sql.entries?.some((entry) => entry.status === "error");
  const sqlDone = Boolean(sql.entries?.length) && !sqlRunning;

  const dataTask = csv?.task;
  const dataRunning = Boolean(csv?.running);
  const dataRows = csv?.parsed?.totalRows ?? csv?.rowCount ?? 0;
  const DataIcon =
    csv?.format === "xlsx" || csv?.format === "parquet"
      ? FileSpreadsheetIcon
      : csv?.format === "json" || csv?.format === "ndjson"
        ? FileJsonIcon
        : FileTextIcon;
  const openIssues = csv?.issues?.errors.length ?? 0;
  const dataBadge = !csv
    ? null
    : dataRunning
      ? badge(
          "info",
          dataTask?.total
            ? `${Math.round(((dataTask.progress ?? 0) / dataTask.total) * 100)} %`
            : "Läuft",
        )
      : csv.outcome?.error
        ? badge("error", "Fehler")
        : csv.outcome
          ? badge("ok", "Importiert")
          : !csv.fileName
            ? null
            : !csv.targetTable
              ? badge("warn", "Ziel fehlt")
              : openIssues > 0
                ? badge("warn", `${openIssues} offen`)
                : !csv.blocked
                  ? badge("ok", "Bereit")
                  : badge("muted", "Prüfen");

  const row = (
    value: "data" | "sql",
    icon: ReactNode,
    title: string,
    meta: ReactNode,
    badge: ReactNode,
    placeholder: boolean,
  ) => (
    <li>
      <button
        type="button"
        aria-current={selected === value ? "true" : undefined}
        className={cn(
          "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted/60",
          selected === value && "bg-muted",
        )}
        onClick={() => onSelect(value)}
      >
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <span className="grid min-w-0 gap-0.5">
          <span
            className={cn(
              "truncate text-sm",
              placeholder ? "text-muted-foreground" : "font-medium",
            )}
          >
            {title}
          </span>
          <span className="truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
        </span>
        {badge}
      </button>
    </li>
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r">
      <div className="p-3">
        <button
          type="button"
          title="CSV/JSON höchstens 1 GiB, Arbeitsmappen höchstens 256 MiB"
          className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed bg-muted/20 px-4 py-5 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
          onClick={onPickAny}
        >
          <UploadCloudIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">Datei auswählen</span>
          <span className="flex flex-wrap justify-center gap-1">
            {(csv ? FORMATS : ["SQL"]).map((format) => (
              <span
                key={format}
                className="rounded border bg-background px-1.5 py-px font-mono text-[10px] text-muted-foreground"
              >
                {format}
              </span>
            ))}
          </span>
        </button>
        {error && <p className="mt-2 text-xs break-words text-destructive">{error}</p>}
      </div>
      <div className="flex items-center justify-between px-4 pt-1 pb-1.5">
        <span className="text-xs font-semibold">Dateien</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Weitere Aktionen">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {csv && (
              <DropdownMenuItem onSelect={onPickData}>
                <FileTextIcon />
                Datendatei wählen…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onPickSql}>
              <FileCodeIcon />
              SQL-Skript wählen…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ul className="grid gap-0.5 px-1.5">
        {csv &&
          row(
            "data",
            <DataIcon className="size-4" />,
            csv.fileName ?? "Datendatei",
            <>
              → {csv.targetTable ?? "Zieltabelle wählen"}
              {csv.parsed ? ` · ${dataRows.toLocaleString("de-DE")} Zeilen` : ""}
            </>,
            dataBadge,
            !csv.fileName,
          )}
        {row(
          "sql",
          <FileCodeIcon className="size-4" />,
          sql.fileName ?? "SQL-Skript",
          statements === null
            ? "Keine Datei"
            : `Skript · ${statements.toLocaleString("de-DE")} Anweisungen`,
          sqlRunning
            ? badge("info", "Läuft")
            : sqlFailed
              ? badge("error", "Fehler")
              : sqlDone
                ? badge("ok", "Ausgeführt")
                : sql.fileName
                  ? badge("muted", "Skript")
                  : null,
          !sql.fileName,
        )}
      </ul>
      <dl className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t px-4 py-3 text-xs">
        {summary.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono tabular-nums">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </aside>
  );
}
