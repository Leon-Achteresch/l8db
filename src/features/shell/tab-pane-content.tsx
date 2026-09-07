import { AlterTableView } from "@/features/alter-table/alter-table-view";
import { ExtensionView } from "@/features/extensions/extension-view";
import { FunctionView } from "@/features/functions/function-view";
import { PackageView } from "@/features/functions/package-view";
import { ProcedureView } from "@/features/functions/procedure-view";
import { QueryView } from "@/features/query/query-view";
import { TableView } from "@/features/table/table-view";
import { TriggerView } from "@/features/triggers/trigger-view";
import { UsersView } from "@/features/users/users-view";
import { ViewEditorView } from "@/features/view-editor/view-editor-view";
import type { Tab } from "@/lib/table-tabs";

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
    default:
      return <ExtensionView name={tab.name} />;
  }
}
