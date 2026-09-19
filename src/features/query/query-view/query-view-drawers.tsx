import { useNavigate } from "@tanstack/react-router";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { QueryHistorySheet } from "@/features/query/query-history-sheet";
import { ScriptResultList, type ScriptRunEntry } from "@/features/query/script-result-list";
import { useTableTabs } from "@/lib/table-tabs";

import { ServerOutputPanel } from "../server-output-panel";
import type { QueryViewCapabilities, QueryViewConnection } from "./types";
import type { QueryExecutionState } from "./use-query-execution-state";
import type { ServerOutputState } from "./use-server-output";

interface QueryViewDrawersProps {
  connection: QueryViewConnection;
  caps: QueryViewCapabilities;
  output: ServerOutputState;
  exec: QueryExecutionState;
  onSelectScriptEntry: (entry: ScriptRunEntry) => void;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  tabId: string;
  onReplaceSql: (tabId: string, sql: string) => void;
}

export function QueryViewDrawers({
  connection,
  caps,
  output,
  exec,
  onSelectScriptEntry,
  historyOpen,
  onHistoryOpenChange,
  tabId,
  onReplaceSql,
}: QueryViewDrawersProps) {
  const navigate = useNavigate();
  const { scriptEntries, setScriptEntries, scriptActiveIndex, setScriptActiveIndex, scriptNote } =
    exec;
  return (
    <>
      {connection && caps.server_output && (
        <Drawer open={output.outputOpen} onOpenChange={output.setOutputOpen}>
          <DrawerContent className="gap-0 p-0">
            <DrawerHeader className="sr-only">
              <DrawerTitle>Server-Ausgabe</DrawerTitle>
              <DrawerDescription>Hinweise und Meldungen der aktiven Verbindung.</DrawerDescription>
            </DrawerHeader>
            <ServerOutputPanel
              connectionId={connection.id}
              connectionName={connection.name}
              enabled={output.outputEnabled}
              busy={output.outputBusy}
              onToggle={(next) => void output.handleToggleServerOutput(next)}
              onClose={() => output.setOutputOpen(false)}
            />
          </DrawerContent>
        </Drawer>
      )}

      <Drawer
        open={Boolean(scriptEntries?.length)}
        onOpenChange={(open) => {
          if (!open) {
            setScriptEntries(null);
            setScriptActiveIndex(null);
          }
        }}
      >
        <DrawerContent className="gap-0 p-0">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Skriptergebnisse</DrawerTitle>
            <DrawerDescription>Einzelergebnisse der Skriptausführung.</DrawerDescription>
          </DrawerHeader>
          {scriptEntries && scriptEntries.length > 0 && (
            <ScriptResultList
              entries={scriptEntries}
              activeIndex={scriptActiveIndex}
              onSelect={onSelectScriptEntry}
              onClose={() => setScriptEntries(null)}
              note={scriptNote}
            />
          )}
        </DrawerContent>
      </Drawer>

      <QueryHistorySheet
        open={historyOpen}
        onOpenChange={onHistoryOpenChange}
        connectionId={connection?.id ?? null}
        onLoad={(loaded, mode) => {
          if (mode === "replace") onReplaceSql(tabId, loaded);
          else {
            const id = useTableTabs.getState().openQueryTabWithSql(loaded);
            void navigate({ to: "/query/$id", params: { id } });
          }
        }}
      />
    </>
  );
}
