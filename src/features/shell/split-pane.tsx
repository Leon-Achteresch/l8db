import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useNavigate } from "@tanstack/react-router";
import { warn as splitDebug } from "@tauri-apps/plugin-log";
import { GripVerticalIcon, XIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { toast } from "sonner";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { TabPaneContent } from "@/features/shell/tab-pane-content";
import { ConnectionScopeContext, useConnectionsStore, usesTunnel } from "@/lib/connections";
import {
  MasterSelectionContext,
  masterDetailKey,
  useMasterDetail,
  usePaneSourceKey,
} from "@/lib/master-detail";
import { ensurePassword } from "@/lib/password-prompt";
import { sameTable } from "@/lib/split-links";
import { usePaneConnectionId, usePaneTabs, useSplitView } from "@/lib/split-view";
import { ensureSshTunnel } from "@/lib/ssh";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { WorkspacePaneContext } from "@/lib/workspace-pane";

import { ColorDot } from "./split-pane/color-dot";
import { MasterSelect } from "./split-pane/master-select";
import { PaneNumber } from "./split-pane/pane-number";
import { ScopedTableContent } from "./split-pane/scoped-table-content";

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
  const setPaneTab = useSplitView((state) => state.setPaneTab);
  const openTab = useTableTabs((state) => state.openTab);
  const remote = Boolean(tab?.connectionId);
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
  const synced = usePaneTabs().some((other, pane) => pane !== index && sameTable(tab, other));
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
    const id =
      value === ACTIVE_VALUE || value === useConnectionsStore.getState().activeId ? null : value;
    void splitDebug(
      `[split-debug] select index=${index} value=${value} id=${id} tab=${tab ? tabKey(tab) : "none"} kind=${tab?.kind} remote=${remote} focused=${focused}`,
    ).catch(() => undefined);
    if (id) {
      const connection = connections.find((entry) => entry.id === id);
      if (!connection) return;
      const passwordOk = await ensurePassword(id);
      void splitDebug(
        `[split-debug] password=${passwordOk} tunnel=${usesTunnel(connection)}`,
      ).catch(() => undefined);
      if (!passwordOk) return;
      if (usesTunnel(connection) && !connection.tunnelPort) {
        const outcome = await ensureSshTunnel(
          useConnectionsStore.getState().connections.find((entry) => entry.id === id) ?? connection,
        );
        if (!outcome.ok) {
          toast.error(outcome.error ?? "SSH-Tunnel konnte nicht geöffnet werden.");
          return;
        }
      }
    }
    if (tab?.kind !== "table" && !remote) {
      setPaneConnection(key, id);
      if (!focused && tab) navigateToTab(navigate, tab);
      onFocus();
      return;
    }
    if (tab?.kind !== "table") {
      setPaneTab(index, null, null);
      setPaneConnection(`split-detail:${index}`, id);
      return;
    }
    if (!id) openTab(tab);
    setPaneTab(index, id, tab);
    void splitDebug(
      `[split-debug] after setPaneTab ${JSON.stringify({ panes: useSplitView.getState().panes, focused: useSplitView.getState().focusedPane })}`,
    ).catch(() => undefined);
    if (!id) navigateToTab(navigate, { ...tab, connectionId: undefined });
  };

  return (
    <WorkspacePaneContext.Provider value={{ index, focused }}>
      <div
        ref={dropRef}
        data-split-pane={index}
        onMouseDown={() => {
          if (!focused && tab && !remote) navigateToTab(navigate, tab);
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
          className={cn(
            "@container flex h-7 shrink-0 items-center gap-1 border-b border-border/70 bg-muted/40",
            synced ? "px-3" : "px-1",
          )}
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
              <PanelErrorBoundary
                label="Diese Ansicht"
                source="split-pane"
                resetKeys={[target, linkKey]}
              >
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
                      overrideId && tab.kind === "table" ? (
                        <ScopedTableContent key={target} tab={tab} />
                      ) : (
                        <TabPaneContent key={target} tab={tab} />
                      )
                    ) : null}
                  </MasterSelectionContext.Provider>
                </Suspense>
              </PanelErrorBoundary>
            </ConnectionScopeContext.Provider>
          ) : (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
              <p className="max-w-56 text-center text-sm text-muted-foreground">
                {override
                  ? `Objekt von ${override.name} in der Sidebar wählen.`
                  : "Tab hierher ziehen oder in der Sidebar öffnen."}
              </p>
            </div>
          )}
        </div>
      </div>
    </WorkspacePaneContext.Provider>
  );
}
