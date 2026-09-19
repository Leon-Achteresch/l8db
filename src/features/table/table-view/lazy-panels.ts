import { lazy } from "react";

export const ViewDefinitionPanel = lazy(() =>
  import("@/features/table/view-definition-panel").then((module) => ({
    default: module.ViewDefinitionPanel,
  })),
);
export const TablePerfPanel = lazy(() =>
  import("@/features/table/table-perf-panel").then((module) => ({
    default: module.TablePerfPanel,
  })),
);
