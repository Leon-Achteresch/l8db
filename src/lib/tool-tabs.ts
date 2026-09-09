import {
  ActivityIcon,
  BlocksIcon,
  DownloadIcon,
  FilePlusIcon,
  FileTextIcon,
  GitCompareIcon,
  HashIcon,
  type LucideIcon,
  NetworkIcon,
  PlugIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  TypeIcon,
} from "lucide-react";
import { type LazyExoticComponent, lazy } from "react";

export type ToolId =
  | "compare"
  | "er-diagram"
  | "enums"
  | "sequences"
  | "monitor"
  | "sessions"
  | "invalid-objects"
  | "replication"
  | "query-builder"
  | "import"
  | "create-table"
  | "saved-plan";

type ToolEntry = {
  path: string;
  label: string;
  Icon: LucideIcon;
  iconColor: string;
  Component: LazyExoticComponent<() => React.ReactElement | null>;
};

export const TOOL_TABS: Record<ToolId, ToolEntry> = {
  compare: {
    path: "/compare",
    label: "Vergleich",
    Icon: GitCompareIcon,
    iconColor: "text-indigo-500",
    Component: lazy(() =>
      import("@/features/compare/compare-view").then((m) => ({ default: m.CompareView })),
    ),
  },
  "er-diagram": {
    path: "/er-diagram",
    label: "ER-Diagramm",
    Icon: NetworkIcon,
    iconColor: "text-blue-500",
    Component: lazy(() =>
      import("@/features/er-diagram/er-diagram-view").then((m) => ({ default: m.ErDiagramView })),
    ),
  },
  enums: {
    path: "/enums",
    label: "Enums",
    Icon: TypeIcon,
    iconColor: "text-lime-500",
    Component: lazy(() =>
      import("@/features/enums/enums-view").then((m) => ({ default: m.EnumsView })),
    ),
  },
  sequences: {
    path: "/sequences",
    label: "Sequenzen",
    Icon: HashIcon,
    iconColor: "text-yellow-500",
    Component: lazy(() =>
      import("@/features/sequences/sequences-view").then((m) => ({ default: m.SequencesView })),
    ),
  },
  monitor: {
    path: "/monitor",
    label: "Monitor",
    Icon: ActivityIcon,
    iconColor: "text-red-500",
    Component: lazy(() =>
      import("@/features/monitor/monitor-view").then((m) => ({ default: m.MonitorView })),
    ),
  },
  sessions: {
    path: "/sessions",
    label: "Sessions",
    Icon: PlugIcon,
    iconColor: "text-teal-500",
    Component: lazy(() =>
      import("@/features/sessions/sessions-view").then((m) => ({ default: m.SessionsView })),
    ),
  },
  "invalid-objects": {
    path: "/invalid-objects",
    label: "Ungültige Objekte",
    Icon: TriangleAlertIcon,
    iconColor: "text-amber-500",
    Component: lazy(() =>
      import("@/features/invalid-objects/invalid-objects-view").then((m) => ({
        default: m.InvalidObjectsView,
      })),
    ),
  },
  replication: {
    path: "/replication",
    label: "Replikation",
    Icon: RefreshCwIcon,
    iconColor: "text-sky-500",
    Component: lazy(() =>
      import("@/features/replication/replication-view").then((m) => ({
        default: m.ReplicationView,
      })),
    ),
  },
  "query-builder": {
    path: "/query-builder",
    label: "Query Builder",
    Icon: BlocksIcon,
    iconColor: "text-violet-500",
    Component: lazy(() =>
      import("@/features/query-builder/query-builder-view").then((m) => ({
        default: m.QueryBuilderView,
      })),
    ),
  },
  import: {
    path: "/import",
    label: "Import",
    Icon: DownloadIcon,
    iconColor: "text-emerald-500",
    Component: lazy(() =>
      import("@/features/import/import-view").then((m) => ({ default: m.ImportView })),
    ),
  },
  "create-table": {
    path: "/create-table",
    label: "Neues Objekt",
    Icon: FilePlusIcon,
    iconColor: "text-emerald-500",
    Component: lazy(() =>
      import("@/features/tables/create-object-view").then((m) => ({ default: m.CreateObjectView })),
    ),
  },
  "saved-plan": {
    path: "/saved-plan",
    label: "Gespeicherter Plan",
    Icon: FileTextIcon,
    iconColor: "text-cyan-500",
    Component: lazy(() =>
      import("@/features/explain/saved-plan-view").then((m) => ({ default: m.SavedPlanView })),
    ),
  },
};

export function toolIdForPath(pathname: string): ToolId | null {
  const entry = Object.entries(TOOL_TABS).find(([, tool]) => tool.path === pathname);
  return entry ? (entry[0] as ToolId) : null;
}
