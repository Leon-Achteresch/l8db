import type { ReactNode } from "react";
import { Suspense } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ObjectAdminMenu } from "@/features/object-admin/object-admin-menu";
import { ObjectAuditPanel } from "@/features/object-admin/object-audit-panel";
import { TableColumnsList } from "@/features/table/table-columns-list";
import { TableDetailTabBar } from "@/features/table/table-detail-tab-bar";
import { TableUsedByPanel } from "@/features/table/table-used-by-panel";
import type { TableDetailTab } from "@/lib/table-detail-tabs";
import { TablePerfPanel, ViewDefinitionPanel } from "./lazy-panels";
import { TableExportDialogs } from "./table-export-dialogs";
import { TableExportMenu } from "./table-export-menu";
import type { useTableViewModel } from "./use-table-view-model";

type Props = Pick<
  ReturnType<typeof useTableViewModel>,
  | "caps"
  | "availableTabs"
  | "viewTab"
  | "data"
  | "exporting"
  | "csvExportOpen"
  | "setCsvExportOpen"
  | "xlsxExportOpen"
  | "setXlsxExportOpen"
  | "exportColumns"
  | "exportRows"
  | "fullExportSource"
  | "handleExport"
  | "setDetailTab"
  | "filter"
> & {
  schema: string;
  table: string;
  dataContent: ReactNode;
};

export function ViewDetailTabs({
  caps,
  availableTabs,
  viewTab,
  data,
  exporting,
  csvExportOpen,
  setCsvExportOpen,
  xlsxExportOpen,
  setXlsxExportOpen,
  exportColumns,
  exportRows,
  fullExportSource,
  handleExport,
  setDetailTab,
  filter,
  schema,
  table,
  dataContent,
}: Props) {
  return (
    <Tabs
      value={viewTab}
      onValueChange={(v) => setDetailTab(v as TableDetailTab)}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        className="flex shrink-0 items-center border-b bg-muted/30 px-3"
        data-tour="table-toolbar"
      >
        <TableDetailTabBar tabs={availableTabs} />
        <div className="ml-auto flex items-center gap-1">
          <ObjectAdminMenu schema={schema} name={table} objectType="view" showAlter={false} />
          {viewTab === "data" && data && (
            <TableExportMenu
              exporting={exporting}
              showSql={true}
              onCsv={() => setCsvExportOpen(true)}
              onXlsx={() => setXlsxExportOpen(true)}
              onExport={handleExport}
            />
          )}
        </div>
      </div>

      <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {dataContent}
      </TabsContent>

      <TabsContent value="columns" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableColumnsList schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="definition" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense
          fallback={
            <div role="status" className="p-4 text-sm text-muted-foreground">
              Ansicht wird geladen…
            </div>
          }
        >
          <ViewDefinitionPanel schema={schema} view={table} />
        </Suspense>
      </TabsContent>

      <TabsContent value="used-by" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableUsedByPanel schema={schema} name={table} />
      </TabsContent>

      <TabsContent value="performance" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {caps.explain && (
          <Suspense
            fallback={
              <div role="status" className="p-4 text-sm text-muted-foreground">
                Ansicht wird geladen…
              </div>
            }
          >
            <TablePerfPanel schema={schema} table={table} filter={filter} isView={true} />
          </Suspense>
        )}
      </TabsContent>

      <TabsContent value="audit" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {caps.object_admin && <ObjectAuditPanel schema={schema} name={table} objectType="view" />}
      </TabsContent>

      <TableExportDialogs
        table={table}
        csvExportOpen={csvExportOpen}
        setCsvExportOpen={setCsvExportOpen}
        xlsxExportOpen={xlsxExportOpen}
        setXlsxExportOpen={setXlsxExportOpen}
        exportColumns={exportColumns}
        exportRows={exportRows}
        fullExportSource={fullExportSource}
      />
    </Tabs>
  );
}
