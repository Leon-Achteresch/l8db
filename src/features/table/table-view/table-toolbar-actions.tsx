import { ClipboardPasteIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useContext, useState } from "react";
import { IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { TestDataDialog } from "@/features/datagen/test-data-dialog";
import { ObjectAdminMenu } from "@/features/object-admin/object-admin-menu";
import { MaskingToggle } from "@/features/table/masking-toggle";
import { PasteRowsDialog } from "@/features/table/paste-rows-dialog";
import { RedisKeyActions } from "@/features/table/redis-key-actions";
import { RowWatchMenuItem } from "@/features/table/row-watch-menu-item";
import { TableExtensionActions } from "@/features/table/table-extension-actions";
import { TimestampDisplayMenu } from "@/features/table/timestamp-display-menu";
import { useReadOnlyConnection } from "@/lib/connections";
import type { useTableExtensionActions } from "@/lib/hooks/use-table-extension-actions";
import { useHasNewFeatures } from "@/lib/new-features";
import { supportsBusinessTimestamp } from "@/lib/timestamp-display";
import { RowWatchContext } from "@/lib/workbench/row-watch-context";
import { TableActionsMenu, TableExportMenu } from "./table-export-menu";
import { TableServerOutput } from "./table-server-output";
import { TableServerOutputMenuItem } from "./table-server-output-menu-item";

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
  | "columnDetails"
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
  columnDetails,
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
  const [outputScope, setOutputScope] = useState<string | null>(null);
  const { scope: watchScope } = useContext(RowWatchContext);
  const watchNew = useHasNewFeatures("table.rows.watch") && Boolean(watchScope);
  const timeNew = useHasNewFeatures("query.results.timestamps");
  const zoneNew = useHasNewFeatures("query.results.timestamps.business-zone");
  const canChooseZone = (columnDetails ?? []).some((column) =>
    supportsBusinessTimestamp(connection?.kind, column.data_type),
  );
  const numbersNew = useHasNewFeatures("query.results.numbers");
  const outputNew = useHasNewFeatures("table.rows.server-output");
  const isData = tableTab === "data";
  const canTestData = isData && connection && caps.test_data;
  const canPaste =
    isData && connection && !connection.readOnly && caps.row_edit && caps.transactions;
  const canAdd = isData && caps.row_edit;
  const canMask = isData && caps.query_language !== "redis";
  const canExport = isData && data;
  const canOutput = isData && connection && caps.server_output;
  const scope = JSON.stringify([connection?.id, database]);
  return (
    <div className="ml-auto flex items-center gap-1">
      <ObjectAdminMenu schema={schema} name={table} objectType="table" />
      {isData && caps.query_language === "redis" && (
        <RedisKeyActions key={`${connection?.id}:${database}`} />
      )}
      {(isData ||
        canMask ||
        canTestData ||
        canPaste ||
        canAdd ||
        canExport ||
        extensionActions.actions.length > 0) && (
        <TableActionsMenu
          businessTimeZone={canChooseZone && isData}
          isNew={
            extensionActions.isNew ||
            (isData && (watchNew || timeNew || numbersNew || (canChooseZone && zoneNew))) ||
            Boolean(canOutput && outputNew)
          }
        >
          {isData && <RowWatchMenuItem />}
          {isData && <TimestampDisplayMenu />}
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
              label="Testdaten oder maskierte Kopie erzeugen"
              onSelect={() => setTestDataOpen(true)}
            />
          )}
          {canMask && <MaskingToggle />}
          {canOutput && (
            <TableServerOutputMenuItem
              connectionId={connection.id}
              database={database ?? null}
              onSelect={() => setOutputScope(scope)}
            />
          )}
          {extensionActions.actions.length > 0 &&
            (canMask || canTestData || canPaste || canAdd) && <IconMenuSeparator />}
          <TableExtensionActions {...extensionActions} />
          {canExport && (
            <>
              <IconMenuSeparator />
              <TableExportMenu
                exporting={exporting}
                showSql={caps.insert_sql}
                onCsv={() => setCsvExportOpen(true)}
                onXlsx={() => setXlsxExportOpen(true)}
                onFormat={setDataExportFormat}
                onExport={handleExport}
              />
            </>
          )}
        </TableActionsMenu>
      )}
      {canOutput && (
        <TableServerOutput
          key={scope}
          connection={connection}
          database={database ?? null}
          open={outputScope === scope}
          onOpenChange={(open) => setOutputScope(open ? scope : null)}
        />
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
