import { useMemo } from "react";
import { TabsContent } from "@/components/ui/tabs";
import type { DetailedColumnInfo } from "@/lib/db";
import type { Row, TableInfo } from "@/lib/ui-plugins/api";
import { columnInfos } from "@/lib/ui-plugins/info";
import type { DetailTabEntry } from "@/lib/ui-plugins/registry";
import { PluginDetailTab } from "./plugin-detail-tab";

const NO_ROWS: readonly Row[] = [];

export function PluginDetailTabsContent({
  entries,
  info,
  stateKey,
  rows,
  columnNames,
  columnDetails,
}: {
  entries: readonly DetailTabEntry[];
  info: TableInfo | null;
  stateKey: string | null | undefined;
  rows: readonly Row[] | undefined;
  columnNames: readonly string[] | undefined;
  columnDetails: readonly DetailedColumnInfo[] | undefined;
}) {
  const columns = useMemo(
    () => (info ? columnInfos(columnNames ?? [], columnDetails) : []),
    [info, columnNames, columnDetails],
  );
  if (!info) return null;
  return entries.map((entry) => (
    <TabsContent
      key={entry.key}
      value={entry.key}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <PluginDetailTab
        entry={entry}
        info={info}
        stateKey={stateKey}
        rows={rows ?? NO_ROWS}
        columns={columns}
      />
    </TabsContent>
  ));
}
