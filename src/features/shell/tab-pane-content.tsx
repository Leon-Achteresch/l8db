import { lazy } from "react";
import type { Tab } from "@/lib/table-tabs";
import { TOOL_TABS } from "@/lib/tool-tabs";

const AlterTableView = lazy(() =>
  import("@/features/alter-table/alter-table-view").then((module) => ({
    default: module.AlterTableView,
  })),
);
const ExtensionView = lazy(() =>
  import("@/features/extensions/extension-view").then((module) => ({
    default: module.ExtensionView,
  })),
);
const ExtensionPanelView = lazy(() =>
  import("@/features/extensions/extension-panel-view").then((module) => ({
    default: module.ExtensionPanelView,
  })),
);
const FunctionView = lazy(() =>
  import("@/features/functions/function-view").then((module) => ({ default: module.FunctionView })),
);
const PackageView = lazy(() =>
  import("@/features/functions/package-view").then((module) => ({ default: module.PackageView })),
);
const ProcedureView = lazy(() =>
  import("@/features/functions/procedure-view").then((module) => ({
    default: module.ProcedureView,
  })),
);
const QueryView = lazy(() =>
  import("@/features/query/query-view").then((module) => ({ default: module.QueryView })),
);
const TableView = lazy(() =>
  import("@/features/table/table-view").then((module) => ({ default: module.TableView })),
);
const TriggerView = lazy(() =>
  import("@/features/triggers/trigger-view").then((module) => ({ default: module.TriggerView })),
);
const UsersView = lazy(() =>
  import("@/features/users/users-view").then((module) => ({ default: module.UsersView })),
);
const ViewEditorView = lazy(() =>
  import("@/features/view-editor/view-editor-view").then((module) => ({
    default: module.ViewEditorView,
  })),
);

export function TabPaneContent({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case "table":
      return (
        <TableView
          schema={tab.schema}
          table={tab.table}
          type={(tab.entityType ?? "table") === "view" ? "view" : undefined}
        />
      );
    case "query":
      return <QueryView tabId={tab.id} />;
    case "function":
      return <FunctionView schema={tab.schema} name={tab.name} oid={tab.oid} />;
    case "procedure":
      return <ProcedureView schema={tab.schema} name={tab.name} oid={tab.oid} />;
    case "package":
      return <PackageView schema={tab.schema} name={tab.name} />;
    case "role":
      return <UsersView name={tab.name} />;
    case "trigger":
      return <TriggerView schema={tab.schema} table={tab.table} trigger={tab.trigger} />;
    case "view-editor":
      return <ViewEditorView schema={tab.schema} view={tab.view} />;
    case "alter-table":
      return <AlterTableView schema={tab.schema} table={tab.table} />;
    case "tool": {
      const ToolComponent = TOOL_TABS[tab.tool].Component;
      return <ToolComponent />;
    }
    case "extension-panel":
      return <ExtensionPanelView extensionId={tab.extensionId} panelId={tab.panelId} />;
    default:
      return <ExtensionView name={tab.name} />;
  }
}
