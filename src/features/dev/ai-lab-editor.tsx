import { Check, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AiAnswer } from "@/features/ai/ai-answer";
import { FileDiff } from "@/features/ai/beui/agents/file-diff";
import { parseAiDiff } from "@/lib/ai/diff";
import { AI_LAB_SQL } from "./ai-lab-data";

const lines = parseAiDiff(
  ` SELECT c.id, c.name, SUM(o.total) AS revenue
 FROM public.customers c
 JOIN public.orders o ON o.customer_id = c.id
-WHERE DATE(o.created_at) = '2026-10-01'
+WHERE o.created_at >= '2026-10-01'
+  AND o.created_at < '2026-10-02'
 GROUP BY c.id, c.name;`,
  "lab-diff",
);

export function AiLabEditor() {
  const [applied, setApplied] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <section
      aria-label="SQL-Editor-Vorschau"
      className="grid h-full min-h-0 min-w-0 overflow-auto @min-[760px]:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="min-w-0 space-y-5 p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium">kunden.sql</h3>
          <Badge variant="secondary">
            {applied ? "Im Demo-Editor übernommen" : "Vorschlag · nicht ausgeführt"}
          </Badge>
        </div>
        <div className="rounded-xl border bg-card p-4">
          {applied ? (
            <AiAnswer streaming={false} text={`\`\`\`sql\n${AI_LAB_SQL}\n\`\`\``} />
          ) : (
            <FileDiff
              file="kunden.sql · vorgeschlagene Änderung"
              lines={lines}
              status="complete"
              language="sql"
              defaultOpen
              maxHeight={350}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setApplied(!applied)}>
            {applied ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
            {applied ? "Änderung zurücknehmen" : "Änderung übernehmen"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFailed(!failed)}>
            {failed ? "Erfolgreichen Plan zeigen" : "Fehlerfall testen"}
          </Button>
        </div>
        {failed ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-xs leading-6"
          >
            <b>Ausführungsplan nicht verfügbar</b>
            <p className="mt-1 text-muted-foreground">
              Beispiel: fehlende Rechte auf public.orders. Der SQL-Vorschlag bleibt erhalten.
            </p>
            <Button size="xs" variant="outline" className="mt-3" onClick={() => setFailed(false)}>
              Prüfung wiederholen
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <div className="border-b px-4 py-3 text-xs font-medium">
              Ausführungsplan · Beispielschätzung
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="p-3">Prüfung</th>
                  <th className="p-3">Vorher</th>
                  <th className="p-3">Vorschlag</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="p-3">Zugriff auf orders</td>
                  <td className="p-3">Seq Scan</td>
                  <td className="p-3 text-primary">Index Scan</td>
                </tr>
                <tr className="border-t">
                  <td className="p-3">Geschätzte Kosten</td>
                  <td className="p-3">1.840</td>
                  <td className="p-3">94</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] leading-6 text-muted-foreground">
          Übernehmen ändert nur diese Vorschau. Keine SQL-Ausführung. Plan-Kosten sind illustrative
          Schätzungen, keine gemessene Beschleunigung.
        </p>
      </div>
      <aside className="space-y-5 border-t bg-muted/20 p-5 @min-[760px]:border-t-0 @min-[760px]:border-l">
        <div className="text-xs font-medium">KI-Assistent</div>
        <AiAnswer
          streaming={false}
          text={
            "## Den Datumsfilter indexfreundlich formulieren.\n\n`DATE(created_at)` wendet eine Funktion auf jede Zeile an. Ein Zeitbereich kann den vorhandenen Index nutzen.\n\nDie Änderung ist direkt im SQL sichtbar. Übernehmen und Ausführen bleiben getrennte Aktionen."
          }
        />
        <div className="rounded-lg border bg-card p-3 text-xs leading-6 text-muted-foreground">
          Kontext: kunden.sql
          <br />
          Shop · public · PostgreSQL
          <br />
          Nur markierte SQL-Zeilen
        </div>
      </aside>
    </section>
  );
}
