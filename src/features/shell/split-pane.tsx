import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useNavigate } from "@tanstack/react-router";
import { GripVerticalIcon, XIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { TabPaneContent } from "@/features/shell/tab-pane-content";
import { ConnectionScopeContext, useConnectionsStore } from "@/lib/connections";
import {
  MasterSelectionContext,
  masterDetailKey,
  useMasterDetail,
  usePaneSourceKey,
} from "@/lib/master-detail";
import { ensurePassword } from "@/lib/password-prompt";
import { usePaneConnectionId, useSplitView } from "@/lib/split-view";
import { ensureSshTunnel } from "@/lib/ssh";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import { type Tab, tabKey } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { WorkspacePaneContext } from "@/lib/workspace-pane";

import { ColorDot } from "./split-pane/color-dot";
import { MasterSelect } from "./split-pane/master-select";
import { PaneNumber } from "./split-pane/pane-number";

const MasterDetailResult = lazy(() =>
  import("@/features/shell/master-detail-result").then((module) => ({
    default: module.MasterDetailResult,
  })),
);

const ACTIVE_VALUE = "__active__";

interface SplitPaneProps {
  index: number;
  focused: boolean;
  tab: Tab | undefined;
  onFocus: () => void;
  onClose: () => void;
}

export function SplitPane({ index, focused, tab, onFocus, onClose }: SplitPaneProps) {
  const navigate = useNavigate();
  const connections = useConnectionsStore((state) => state.connections);
  const setPaneConnection = useSplitView((state) => state.setPaneConnection);
  const key = tab ? tabKey(tab) : `split-detail:${index}`;
  const masterKey = useSplitView((state) => {
    const master = state.masters[index];
    return master == null ? null : (state.panes[master] ?? `split-detail:${master}`);
  });
  const source = usePaneSourceKey(masterKey);
  const target = usePaneSourceKey(key);
  const linkKey = masterKey ? masterDetailKey(source, target) : null;
  const detailSql = useMasterDetail((state) => (linkKey ? state.scripts[linkKey] : undefined));
  const sourceColumn = useMasterDetail((state) =>
    linkKey ? state.sourceColumns[linkKey] : undefined,
  );
  const feedsNext = useSplitView((state) => state.masters.includes(index));
  const overrideId = usePaneConnectionId(key);
  const override = connections.find((entry) => entry.id === overrideId) ?? null;
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `pane:${index}`,
    type: "pane",
    accept: ["tab", "pane"],
  });
  const { ref: dragRef, handleRef } = useDraggable({
    id: `pane-drag:${index}`,
    type: "pane",
    data: { index },
  });

  const selectConnection = async (value: string) => {
    if (!key) return;
    if (value === ACTIVE_VALUE) {
      setPaneConnection(key, null);
      return;
    }
    const connection = connections.find((entry) => entry.id === value);
    if (!connection) return;
    if (!(await ensurePassword(value))) return;
    if (connection.ssh?.host && !connection.tunnelPort) {
      const outcome = await ensureSshTunnel(
        useConnectionsStore.getState().connections.find((entry) => entry.id === value) ??
          connection,
      );
      if (!outcome.ok) {
        toast.error(outcome.error ?? "SSH-Tunnel konnte nicht geöffnet werden.");
        return;
      }
    }
    setPaneConnection(key, value);
  };

  return (
    <WorkspacePaneContext.Provider value={{ index, focused }}>
      <div
        ref={dropRef}
        data-split-pane={index}
        onMouseDown={() => {
          if (!focused && tab) navigateToTab(navigate, tab);
          onFocus();
        }}
        className={cn(
          "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
          "after:pointer-events-none after:absolute after:inset-0 after:z-30",
          isDropTarget
            ? "bg-primary/5 after:ring-2 after:ring-inset after:ring-primary"
            : focused
              ? "after:ring-2 after:ring-inset after:ring-primary"
              : "after:ring-1 after:ring-inset after:ring-border/80",
        )}
      >
        <div
          ref={dragRef}
          className="@container flex h-7 shrink-0 items-center gap-1 border-b border-border/70 bg-muted/40 px-1"
          style={override ? { backgroundColor: `${override.color ?? "#64748b"}1a` } : undefined}
          title={override ? `Verbindung: ${override.name}` : undefined}
        >
          <span
            ref={handleRef}
            title="Bereich verschieben"
            className="grid size-5 shrink-0 cursor-grab place-items-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-3.5" />
          </span>
          <PaneNumber index={index} />
          <span className="min-w-[4.5rem] flex-1 truncate text-xs font-medium text-muted-foreground">
            {detailSql && feedsNext
              ? "Detail → Master · "
              : detailSql
                ? "Detail · "
                : feedsNext
                  ? "Master · "
                  : ""}
            {tab ? tabLabel(tab) : detailSql ? "SQL-Abfrage" : "Leer"}
          </span>
          <MasterSelect index={index} />
          {tab || detailSql ? (
            <Select value={overrideId ?? ACTIVE_VALUE} onValueChange={selectConnection}>
              <SelectTrigger
                size="sm"
                onMouseDown={(event) => event.stopPropagation()}
                aria-label="Verbindung für diesen Bereich"
                className="h-5 max-w-36 gap-1 border-0 px-1 py-0 text-xs shadow-none dark:bg-transparent dark:hover:bg-foreground/10"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ColorDot color={override?.color} />
                  <span className="truncate">{override ? override.name : "Aktive Verbindung"}</span>
                </span>
              </SelectTrigger>
              <SelectContent searchable onMouseDown={(event) => event.stopPropagation()}>
                <SelectItem value={ACTIVE_VALUE} className="text-xs">
                  Aktive Verbindung
                </SelectItem>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id} className="text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ColorDot color={connection.color} />
                      <span className="truncate">{connection.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label="Bereich schließen"
            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tab || detailSql ? (
            <ConnectionScopeContext.Provider value={overrideId}>
              <Suspense
                fallback={
                  <div role="status" className="p-4 text-sm text-muted-foreground">
                    Ansicht wird geladen…
                  </div>
                }
              >
                <MasterSelectionContext.Provider value={target}>
                  {detailSql && source ? (
                    <MasterDetailResult
                      key={linkKey}
                      source={source}
                      sql={detailSql}
                      column={sourceColumn}
                    />
                  ) : tab ? (
                    <TabPaneContent key={target} tab={tab} />
                  ) : null}
                </MasterSelectionContext.Provider>
              </Suspense>
            </ConnectionScopeContext.Provider>
          ) : (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
              <p className="max-w-56 text-center text-sm text-muted-foreground">
                Tab hierher ziehen oder in der Sidebar öffnen.
              </p>
            </div>
          )}
        </div>
      </div>
    </WorkspacePaneContext.Provider>
  );
}
