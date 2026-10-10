import {
  applyOptions,
  CHARTS,
  type ChartKind,
  type Dataset,
  datasetShape,
  refLabel,
  type Widget,
  widgetFits,
  widgetOptions,
} from "@/lib/dashboards";
import { retainChartMetricSelection } from "./chart-metric-selection";

export interface ChartDraft {
  widget: Widget;
  dataset: Dataset;
}

export function draftReady(dataset: Dataset): boolean {
  return dataset.mode === "expert"
    ? dataset.sql.trim().length > 0 && dataset.mapping.metrics.length > 0
    : Boolean(dataset.simple.table) &&
        dataset.simple.metrics.some((m) => m.agg === "count" || m.column);
}

export function autoTitle(dataset: Dataset, widget: Widget): string {
  const shape = applyOptions(datasetShape(dataset), [], widgetOptions(widget)).shape;
  const metric = shape.metrics[0]?.label;
  if (dataset.mode === "expert" || !metric || !dataset.simple.table) return dataset.name;
  const dim = dataset.simple.dimension;
  return dim ? `${metric} pro ${refLabel(dim.column, dataset.simple)}` : metric;
}

export function preferredChart(dataset: Dataset): ChartKind {
  const shape = datasetShape(dataset);
  const dated =
    dataset.mode === "simple" &&
    dataset.simple.dimension &&
    dataset.simple.dimension.bucket !== "none";
  const preferred: ChartKind = !shape.dimension ? "kpi" : dated ? "line" : "column";
  const all = Object.keys(CHARTS) as ChartKind[];
  return [preferred, ...all].find((k) => !widgetFits(k, shape)) ?? preferred;
}

function fitChart(current: ChartKind, prev: Dataset, next: Dataset): ChartKind {
  const auto = current === preferredChart(prev);
  return auto || widgetFits(current, datasetShape(next)) ? preferredChart(next) : current;
}

export function patchDraftDataset(draft: ChartDraft, patch: Partial<Dataset>): ChartDraft {
  const next = { ...draft.dataset, ...patch };
  return {
    dataset: next,
    widget: {
      ...draft.widget,
      chart: fitChart(draft.widget.chart, draft.dataset, next),
      options: retainChartMetricSelection(draft.dataset, next, draft.widget.options),
    },
  };
}

export function finishedDraft(draft: ChartDraft): ChartDraft {
  return {
    widget: draft.widget,
    dataset: { ...draft.dataset, name: autoTitle(draft.dataset, draft.widget) },
  };
}

export function canFinishDraft(draft: ChartDraft): boolean {
  const shape = datasetShape(draft.dataset);
  return (
    draftReady(draft.dataset) &&
    !widgetFits(draft.widget.chart, applyOptions(shape, [], widgetOptions(draft.widget)).shape)
  );
}
