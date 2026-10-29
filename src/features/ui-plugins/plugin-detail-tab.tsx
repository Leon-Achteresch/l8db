import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { navigateToTab } from "@/lib/tab-navigation";
import { useTableTabs } from "@/lib/table-tabs";
import type { ColumnInfo, Row, TableInfo } from "@/lib/ui-plugins/api";
import type { DetailTabEntry } from "@/lib/ui-plugins/registry";
import { freezeRows } from "@/lib/ui-plugins/rows";
import { pluginSelection, pluginServices } from "@/lib/ui-plugins/table-slots";
import { PluginBoundary } from "./plugin-boundary";
import { PluginRender } from "./plugin-render";

export function PluginDetailTab({
  entry,
  info,
  stateKey,
  rows,
  columns,
}: {
  entry: DetailTabEntry;
  info: TableInfo;
  stateKey: string | null | undefined;
  rows: readonly Row[];
  columns: readonly ColumnInfo[];
}) {
  const navigate = useNavigate();
  const openTab = useTableTabs((state) => state.openTab);
  const props = useMemo(
    () => ({
      ...pluginServices(entry.plugin, (tab) => {
        openTab(tab);
        navigateToTab(navigate, { kind: "table", ...tab });
      }),
      table: info,
      columns,
      rows: freezeRows(rows),
      selection: freezeRows(pluginSelection(stateKey, rows)),
    }),
    [entry.plugin, info, columns, rows, stateKey, openTab, navigate],
  );
  return (
    <div
      data-ui-plugin={entry.plugin.id}
      className="min-h-0 flex-1 overflow-auto p-3"
      style={{ contain: "layout paint" }}
    >
      <PluginBoundary
        plugin={entry.plugin.id}
        resetKey={entry}
        fallback={
          <p className="text-sm text-muted-foreground">
            {entry.plugin.name}: Dieser Tab hat einen Fehler. Details unter Einstellungen →
            Erweiterungen → UI-Plugins.
          </p>
        }
      >
        <PluginRender render={() => entry.tab.render(props)} />
      </PluginBoundary>
    </div>
  );
}
