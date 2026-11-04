import { ChartColumn, Code2, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiResultTable } from "@/features/ai/ai-result-table";
import { ResultChartCanvas } from "@/features/query/result-chart/result-chart-canvas";
import { buildChartData } from "@/lib/result-chart";
import { AI_LAB_TABLE } from "./ai-lab-data";

export function AiLabResults() {
  const [tab, setTab] = useState("chart");
  const data = useMemo(
    () =>
      buildChartData(AI_LAB_TABLE.rows, {
        chart: "column",
        x: "Kundengruppe",
        y: ["September", "Oktober"],
        series: null,
        agg: "none",
        sort: "none",
        topN: null,
      }),
    [],
  );

  return (
    <section aria-label="Analyseergebnisse" className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h3 className="text-sm font-semibold">Ergebnisse</h3>
        <Badge variant="secondary">1 Abbildung</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
        <div>
          <p className="text-xs text-muted-foreground">Umsatz · Oktober gegenüber September</p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">−18,4 %</span>
            <span className="text-xs text-muted-foreground">−99.000 €</span>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-xs font-medium">
            <Badge variant="outline">Abb. 1</Badge> Umsatz nach Kundengruppe
          </div>
          <Tabs value={tab} onValueChange={setTab} className="gap-0">
            <TabsList variant="line" aria-label="Ergebnisdarstellung" className="mx-2 mt-1">
              <TabsTrigger value="chart">
                <ChartColumn className="size-3.5" /> Diagramm
              </TabsTrigger>
              <TabsTrigger value="table">
                <Table2 className="size-3.5" /> Tabelle
              </TabsTrigger>
              <TabsTrigger value="sql">
                <Code2 className="size-3.5" /> SQL
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chart" className="h-64 flex-none">
              <ResultChartCanvas chart="column" data={data} />
            </TabsContent>
            <TabsContent value="table">
              <AiResultTable table={AI_LAB_TABLE} />
            </TabsContent>
            <TabsContent value="sql">
              <pre className="overflow-auto p-4 font-mono text-[11px] leading-6">{`SELECT customer_group,
  SUM(total) FILTER (WHERE month = 9) AS september,
  SUM(total) FILTER (WHERE month = 10) AS oktober
FROM public.monthly_revenue
GROUP BY customer_group;`}</pre>
            </TabsContent>
          </Tabs>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            2 Gruppen · vollständige Beispieldaten
          </p>
        </div>
        <div className="space-y-2 rounded-xl border bg-card p-4 text-xs">
          <h4 className="font-medium">Herkunft & Umfang</h4>
          <p className="leading-6 text-muted-foreground">
            Shop · public.monthly_revenue
            <br />
            01.09.–31.10.2026 · Europe/Berlin
            <br />
            Keine echte Abfrage ausgeführt.
          </p>
        </div>
      </div>
    </section>
  );
}
