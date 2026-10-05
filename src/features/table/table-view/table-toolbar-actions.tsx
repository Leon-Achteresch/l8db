import { ClipboardPasteIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { TestDataDialog } from "@/features/datagen/test-data-dialog";
import { ObjectAdminMenu } from "@/features/object-admin/object-admin-menu";
import { MaskingToggle } from "@/features/table/masking-toggle";
import { PasteRowsDialog } from "@/features/table/paste-rows-dialog";
import { RedisKeyActions } from "@/features/table/redis-key-actions";
import { TableExtensionActions } from "@/features/table/table-extension-actions";
import { useReadOnlyConnection } from "@/lib/connections";
import type { useTableExtensionActions } from "@/lib/hooks/use-table-extension-actions";
import { TableActionsMenu, TableExportMenu } from "./table-export-menu";

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
  | "setDataExportFormat"
  | "handleExport"
  | "requestAddRow"
> & {
  schema: string;
  table: string;
  extensionActions: ReturnType<typeof useTableExtensionActions>;
};

export function TableToolbarActions({
  extensionActions,
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
  setDataExportFormat,
  handleExport,
  requestAddRow,
  schema,
  table,
}: Props) {
  const readOnly = useReadOnlyConnection();
  const [testDataOpen, setTestDataOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const isData = tableTab === "data";
  const canTestData = isData && connection && caps.test_data;
  const canPaste =
    isData && connection && !connection.readOnly && caps.row_edit && caps.transactions;
  const canAdd = isData && caps.row_edit;
  const canMask = isData && caps.query_language !== "redis";
  const canExport = isData && data;
  return (
    <div className="ml-auto flex items-center gap-1">
      <ObjectAdminMenu schema={schema} name={table} objectType="table" />
      {isData && caps.query_language === "redis" && (
        <RedisKeyActions key={`${connection?.id}:${database}`} />
      )}
      {(canMask ||
        canTestData ||
        canPaste ||
        canAdd ||
        canExport ||
        extensionActions.actions.length > 0) && (
        <TableActionsMenu isNew={extensionActions.isNew}>
          {canAdd && (
            <IconMenuItem
              icon={<PlusIcon />}
              label="Neue Zeile"
              onSelect={requestAddRow}
              disabled={insertRowMutation.isPending}
            />
          )}
          {canPaste && (
            <IconMenuItem
              icon={<ClipboardPasteIcon />}
              label="Tabellenblock einfügen"
              onSelect={() => setPasteOpen(true)}
            />
          )}
          {canTestData && (
            <IconMenuItem
              icon={<SparklesIcon />}
              label="Testdaten / Maskierte Kopie"
              onSelect={() => setTestDataOpen(true)}
            />
          )}
          {canMask && <MaskingToggle />}
          {extensionActions.actions.length > 0 &&
            (canMask || canTestData || canPaste || canAdd) && <IconMenuSeparator />}
          <TableExtensionActions {...extensionActions} />
          {canExport && (
            <>
              <IconMenuSeparator />
              <TableExportMenu
                exporting={exporting}
                showSql={caps.query_language !== "redis" && caps.query_language !== "json"}
                onCsv={() => setCsvExportOpen(true)}
                onXlsx={() => setXlsxExportOpen(true)}
                onFormat={setDataExportFormat}
                onExport={handleExport}
              />
            </>
          )}
        </TableActionsMenu>
      )}
      {canTestData && (
        <TestDataDialog
          connection={connection}
          database={database}
          schema={schema}
          table={table}
          readOnly={readOnly || Boolean(connection.readOnly)}
          open={testDataOpen}
          onOpenChange={setTestDataOpen}
          onComplete={() => {
            void refetch();
          }}
        />
      )}
      {canPaste && (
        <PasteRowsDialog
          key={stateKey ?? table}
          connection={connection}
          database={database}
          schema={schema}
          table={table}
          open={pasteOpen}
          onOpenChange={setPasteOpen}
          onComplete={() => {
            void refetch();
          }}
        />
      )}
    </div>
  );
}
