import { useNavigate } from "@tanstack/react-router";
import { type Ref, useImperativeHandle, useState } from "react";

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

import type { QueryViewConnection } from "./types";
import type { QueryExecutionState } from "./use-query-execution-state";

interface QueryViewDrawersProps {
  connection: QueryViewConnection;
  exec: QueryExecutionState;
  onSelectScriptEntry: (entry: ScriptRunEntry) => void;
  historyRef: Ref<QueryHistoryHandle>;
  tabId: string;
  onReplaceSql: (tabId: string, sql: string) => void;
}

export interface QueryHistoryHandle {
  open: () => void;
  toggle: () => void;
}

export function QueryViewDrawers({
  connection,
  exec,
  onSelectScriptEntry,
  historyRef,
  tabId,
  onReplaceSql,
}: QueryViewDrawersProps) {
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);
  useImperativeHandle(
    historyRef,
    () => ({
      open: () => setHistoryOpen(true),
      toggle: () => setHistoryOpen((open) => !open),
    }),
    [],
  );
  const { scriptEntries, setScriptEntries, scriptActiveIndex, setScriptActiveIndex, scriptNote } =
    exec;
  return (
    <>
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
              featureId={connection?.kind === "oracle" ? "query.sqlplus-session" : undefined}
            />
          )}
        </DrawerContent>
      </Drawer>

      <QueryHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
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
