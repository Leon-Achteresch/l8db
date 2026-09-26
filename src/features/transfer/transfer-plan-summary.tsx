import { ShieldCheckIcon, TriangleAlertIcon, UndoIcon } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TransferPlan, TransferStatement } from "@/lib/db";

const PHASES: { key: keyof TransferPlan; label: string }[] = [
  { key: "preData", label: "Struktur vor dem Laden" },
  { key: "beforeLoad", label: "Vorbereitung" },
  { key: "postData", label: "Schlüssel, Indizes, Fremdschlüssel, Code-Objekte" },
  { key: "finalize", label: "Sequenzen und Identity" },
];

function script(plan: TransferPlan): string {
  const sections = [
    plan.createSchemas.length > 0
      ? `-- Schemas anlegen\n${plan.createSchemas.map((schema) => `-- ${schema}`).join("\n")}`
      : "",
    ...PHASES.map(({ key, label }) => {
      const statements = plan[key] as TransferStatement[];
      if (statements.length === 0) return "";
      return `-- ${label}\n${statements.map((statement) => statement.sql.trim()).join(";\n\n")};`;
    }),
  ];
  const data = `-- Daten: ${plan.tables.length} Tabellen in dieser Reihenfolge\n${plan.tables
    .map((table) => `--   ${table.targetSchema}.${table.targetName}`)
    .join("\n")}`;
  return [sections[0], sections[1], sections[2], data, sections[3], sections[4]]
    .filter(Boolean)
    .join("\n\n");
}

export function TransferPlanSummary({ plan }: { plan: TransferPlan }) {
  const text = useMemo(() => script(plan), [plan]);
  const columns = plan.tables.reduce((sum, table) => sum + table.columns.length, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary">
          {plan.native ? "Gleiche Familie: native Struktur" : "Familienwechsel: Typumsetzung"}
        </Badge>
        <Badge variant="outline">
          {plan.atomic ? (
            <ShieldCheckIcon className="text-emerald-600" />
          ) : (
            <UndoIcon className="text-amber-600" />
          )}
          {plan.atomic
            ? "Atomar in einer Zieltransaktion"
            : "Kompensation: angelegte Objekte werden bei Fehler entfernt"}
        </Badge>
        <span className="text-muted-foreground">
          {plan.tables.length} Tabellen · {columns} Spalten ·{" "}
          {plan.preData.length + plan.postData.length + plan.finalize.length} Anweisungen
        </span>
      </div>
      {plan.conflicts.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <p className="font-medium">
            Im Ziel existieren bereits {plan.conflicts.length} Objekte. Der Transfer überschreibt
            nichts; bitte Zielschema ändern oder die Objekte entfernen.
          </p>
          <p className="mt-1 font-mono">{plan.conflicts.slice(0, 30).join(", ")}</p>
        </div>
      )}
      <Tabs defaultValue="tables" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="tables">Tabellen</TabsTrigger>
          <TabsTrigger value="script">Skript</TabsTrigger>
          <TabsTrigger value="manual">Manuell ({plan.manual.length})</TabsTrigger>
          <TabsTrigger value="warnings">Hinweise ({plan.warnings.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="tables" className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">#</th>
                <th className="py-1 pr-2 font-medium">Quelle</th>
                <th className="py-1 pr-2 font-medium">Ziel</th>
                <th className="py-1 font-medium">Spalten</th>
              </tr>
            </thead>
            <tbody>
              {plan.tables.map((table, index) => (
                <tr
                  key={`${table.sourceSchema}.${table.sourceName}`}
                  className="border-t align-top"
                >
                  <td className="py-1 pr-2 tabular-nums text-muted-foreground">{index + 1}</td>
                  <td className="py-1 pr-2 font-mono">
                    {table.sourceSchema}.{table.sourceName}
                  </td>
                  <td className="py-1 pr-2 font-mono">
                    {table.targetSchema}.{table.targetName}
                  </td>
                  <td className="py-1 font-mono text-muted-foreground">
                    {table.columns
                      .map((column) =>
                        plan.native
                          ? column.target
                          : `${column.target} ${column.sourceType} → ${column.targetType}`,
                      )
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>
        <TabsContent value="script" className="min-h-0 flex-1 overflow-auto">
          <pre className="rounded-md border bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
            {text}
          </pre>
        </TabsContent>
        <TabsContent value="manual" className="min-h-0 flex-1 overflow-auto">
          {plan.manual.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Alle Objekte werden automatisch übertragen.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {plan.manual.map((object) => (
                <details
                  key={`${object.objectType}|${object.schema}|${object.name}`}
                  className="rounded-md border p-2 text-xs"
                >
                  <summary className="cursor-pointer">
                    <span className="font-medium">{object.objectType}</span>{" "}
                    <span className="font-mono">
                      {object.schema}.{object.name}
                    </span>
                    <span className="text-muted-foreground"> · {object.reason}</span>
                  </summary>
                  {object.ddl && (
                    <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap">
                      {object.ddl}
                    </pre>
                  )}
                </details>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="warnings" className="min-h-0 flex-1 overflow-auto">
          {plan.warnings.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Hinweise.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {plan.warnings.map((warning) => (
                <li key={warning} className="flex gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
