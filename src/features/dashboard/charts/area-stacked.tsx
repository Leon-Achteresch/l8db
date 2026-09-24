import type { ChartProps } from "./chart-utils";
import { PointSeriesChart } from "./point-series-chart";

export function AreaStacked(props: ChartProps) {
  return <PointSeriesChart {...props} area />;
}
