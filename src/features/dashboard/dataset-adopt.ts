import {
  type Dataset,
  DIM_KEY,
  DIM2_KEY,
  datasetShape,
  datasetSql,
  metricKey,
} from "@/lib/dashboards";
import type { DatabaseKind } from "@/lib/db";

export function adoptSimple(dataset: Dataset, kind: DatabaseKind | null): Partial<Dataset> {
  const from: Dataset["mode"] = dataset.mode === "flow" ? "flow" : "simple";
  const shape = datasetShape({ ...dataset, mode: from });
  return {
    sql: datasetSql({ ...dataset, mode: from }, kind, "all"),
    mapping: {
      dimension: shape.dimension ? DIM_KEY : null,
      dimension2: shape.dimension2 ? DIM2_KEY : null,
      metrics: shape.metrics.map((_, i) => metricKey(i)),
      dateColumn: null,
    },
  };
}
