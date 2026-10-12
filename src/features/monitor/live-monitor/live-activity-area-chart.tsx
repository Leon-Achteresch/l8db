import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LIVE_CHART_METRICS, type LiveChartMetric, type LiveChartRow } from "./live-chart-metrics";

function clockFormatter(rows: LiveChartRow[]) {
  const span = rows.length ? rows[rows.length - 1].at - rows[0].at : 0;
  const options: Intl.DateTimeFormatOptions =
    span < 10 * 60_000
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
  return (value: number) => new Date(value).toLocaleTimeString("de-DE", options);
}

export function LiveActivityAreaChart({
  rows,
  metric,
}: {
  rows: LiveChartRow[];
  metric: LiveChartMetric;
}) {
  const definition = LIVE_CHART_METRICS[metric];
  const config = Object.fromEntries(
    definition.series.map((series) => [series.key, { label: series.label, color: series.color }]),
  );
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={true} strokeDasharray="0" strokeOpacity={0.35} />
        <XAxis
          dataKey="at"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={clockFormatter(rows)}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
        />
        <YAxis
          width={52}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => value.toLocaleString("de-DE")}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const at = payload?.[0]?.payload?.at;
                return typeof at === "number" ? new Date(at).toLocaleTimeString("de-DE") : "";
              }}
            />
          }
        />
        {definition.series.map((series) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            stroke={`var(--color-${series.key})`}
            fill={`var(--color-${series.key})`}
            fillOpacity={0.18}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
