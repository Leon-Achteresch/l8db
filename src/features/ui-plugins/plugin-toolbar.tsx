import { useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import type { DetailedColumnInfo } from "@/lib/db";
import { navigateToTab } from "@/lib/tab-navigation";
import { useTableTabs } from "@/lib/table-tabs";
import type { Row, TableInfo } from "@/lib/ui-plugins/api";
import { columnInfos } from "@/lib/ui-plugins/info";
import type { ToolbarEntry } from "@/lib/ui-plugins/registry";
import { freezeRows } from "@/lib/ui-plugins/rows";
import { errorMessage, reportUiPluginError } from "@/lib/ui-plugins/store";
import {
  pluginCopy,
  pluginSelection,
  pluginServices,
  pluginToast,
  usePluginToolbar,
} from "@/lib/ui-plugins/table-slots";
import { TONE_COLORS } from "@/lib/ui-plugins/tones";

const NO_ROWS: readonly Row[] = [];

export function PluginToolbar({
  info,
  stateKey,
  rows = NO_ROWS,
  columnNames,
  columnDetails,
  refresh,
}: {
  info: TableInfo | null;
  stateKey: string | null | undefined;
  rows: readonly Row[] | undefined;
  columnNames: readonly string[] | undefined;
  columnDetails: readonly DetailedColumnInfo[] | undefined;
  refresh: () => void;
}) {
  const entries = usePluginToolbar(info);
  const navigate = useNavigate();
  const openTab = useTableTabs((state) => state.openTab);
  const [running, setRunning] = useState<string | null>(null);
  if (!info || entries.length === 0) return null;

  const run = async (entry: ToolbarEntry) => {
    setRunning(entry.key);
    try {
      await entry.action.run({
        ...pluginServices(entry.plugin, (tab) => {
          openTab(tab);
          navigateToTab(navigate, { kind: "table", ...tab });
        }),
        table: info,
        columns: columnInfos(columnNames ?? [], columnDetails),
        rows: freezeRows(rows),
        selection: freezeRows(pluginSelection(stateKey, rows)),
        copy: pluginCopy,
        refresh,
      });
    } catch (error) {
      pluginToast(entry.plugin, errorMessage(error), "danger");
      reportUiPluginError(entry.plugin.id, error);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex items-center gap-1" data-ui-plugin-toolbar="">
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          disabled={running !== null}
          onClick={() => void run(entry)}
          title={`${entry.action.label} · ${entry.plugin.name}`}
          className="flex h-6 max-w-40 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-foreground/90 transition-colors hover:bg-muted disabled:opacity-60"
        >
          {running === entry.key ? (
            <LoaderCircleIcon className="size-3 motion-safe:animate-spin" />
          ) : (
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: TONE_COLORS[entry.action.tone ?? "neutral"] }}
            />
          )}
          <span className="truncate">{entry.action.label}</span>
        </button>
      ))}
    </div>
  );
}
