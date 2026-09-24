import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ObjectAdminMenu } from "@/features/object-admin/object-admin-menu";
import { PasteRowsDialog } from "@/features/table/paste-rows-dialog";
import { RedisKeyActions } from "@/features/table/redis-key-actions";
import { TableExportMenu } from "./table-export-menu";

import type { useTableViewModel } from "./use-table-view-model";

type Props = Pick<
  ReturnType<typeof useTableViewModel>,
  | "connection"
  | "database"
  | "stateKey"
  | "caps"
  | "tableTab"
  | "insertRowMutation"
  | "data"
  | "refetch"
  | "exporting"
  | "setCsvExportOpen"
  | "setXlsxExportOpen"
  | "handleExport"
  | "requestAddRow"
> & {
  schema: string;
  table: string;
};

export function TableToolbarActions({
  connection,
  database,
  stateKey,
  caps,
  tableTab,
  insertRowMutation,
  data,
  refetch,
  exporting,
  setCsvExportOpen,
  setXlsxExportOpen,
  handleExport,
  requestAddRow,
  schema,
  table,
}: Props) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <ObjectAdminMenu schema={schema} name={table} objectType="table" />
      {tableTab === "data" &&
        connection &&
        !connection.readOnly &&
        caps.row_edit &&
        caps.transactions && (
          <PasteRowsDialog
            key={stateKey ?? table}
            connection={connection}
            database={database}
            schema={schema}
            table={table}
            onComplete={() => {
              void refetch();
            }}
          />
        )}
      {tableTab === "data" && caps.query_language === "redis" && (
        <RedisKeyActions key={`${connection?.id}:${database}`} />
      )}
      {tableTab === "data" && caps.row_edit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Neue Zeile"
              data-tour="table-add"
              onClick={requestAddRow}
              disabled={insertRowMutation.isPending}
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Neue Zeile</TooltipContent>
        </Tooltip>
      )}
      {tableTab === "data" && data && (
        <TableExportMenu
          exporting={exporting}
          showSql={caps.query_language !== "redis" && caps.query_language !== "json"}
          onCsv={() => setCsvExportOpen(true)}
          onXlsx={() => setXlsxExportOpen(true)}
          onExport={handleExport}
        />
      )}
    </div>
  );
}
