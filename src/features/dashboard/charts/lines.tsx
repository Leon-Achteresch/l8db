import type { ChartProps } from "./chart-utils";
import { PointSeriesChart } from "./point-series-chart";

export function Lines(props: ChartProps) {
  return <PointSeriesChart {...props} area={false} />;
}
