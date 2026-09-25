import type { DatabaseKind } from "@/lib/db";
import type { ResultChartState } from "@/lib/result-chart";

export interface ResultChartBinding {
  state: ResultChartState;
  onChange: (state: ResultChartState) => void;
  sql: string;
  name: string;
  connectionId: string | null;
  database: string | null;
  kind: DatabaseKind | null;
  sqlCapable: boolean;
}
