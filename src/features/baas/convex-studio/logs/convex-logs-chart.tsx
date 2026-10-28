import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { LogBucket } from "./convex-logs-buffer";

const CONFIG: ChartConfig = {
  requests: { label: "Ausführungen", color: "var(--chart-1)" },
  errors: { label: "Fehler", color: "var(--destructive)" },
};

const clock = (value: number) =>
  new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export function ConvexLogsChart({ buckets, size }: { buckets: LogBucket[]; size: number }) {
  const minutes = size / 60_000;
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Ausführungen und Fehler {minutes === 1 ? "pro Minute" : `pro ${minutes} Minuten`} im Puffer
      </p>
      {buckets.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Noch keine Ausführungen.</p>
      ) : (
        <ChartContainer config={CONFIG} className="h-36 w-full">
          <BarChart data={buckets} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.35} />
            <XAxis
              dataKey="at"
              tickFormatter={clock}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={32}
            />
            <YAxis width={32} allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const at = payload?.[0]?.payload?.at;
                    return typeof at === "number" ? clock(at) : "";
                  }}
                />
              }
            />
            <Bar dataKey="requests" fill="var(--color-requests)" isAnimationActive={false} />
            <Bar dataKey="errors" fill="var(--color-errors)" isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
