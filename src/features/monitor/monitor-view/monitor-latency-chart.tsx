import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { MonitorViewState } from "./use-monitor-view";

export function MonitorLatencyChart({ data }: { data: MonitorViewState["latencyData"] }) {
  return (
    <ChartContainer
      config={{ duration: { label: "Laufzeit", color: "var(--primary)" } }}
      className="h-64 w-full"
    >
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="monitor-duration" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-duration)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-duration)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          width={48}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value} ms`}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="duration"
          stroke="var(--color-duration)"
          fill="url(#monitor-duration)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
