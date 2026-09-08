import { useHotkeys } from "@tanstack/react-hotkeys";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { useActiveConnection } from "@/lib/connections";
import { openSqlFileAsTab } from "@/lib/hooks/use-query-file";
import { commandById, emitHotkeyAction, HOTKEY_ACTION_EVENT, useHotkeysStore } from "@/lib/hotkeys";
import { useRefreshConnection } from "@/lib/queries";
import { navigateToTab } from "@/lib/tab-navigation";
import { tabKey, useTableTabs } from "@/lib/table-tabs";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

export function AppHotkeys() {
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeTab = useActiveWorkspaceTab();
  const connection = useActiveConnection();
  const { refresh } = useRefreshConnection();
  const overrides = useHotkeysStore((state) => state.overrides);
  const inQueryRoute = pathname.startsWith("/query");

  const activeKey = activeTab ? tabKey(activeTab) : null;

  const goToTabIndex = useCallback(
    (index: number, last = false) => {
      const tabs = useTableTabs.getState().tabs;
      if (tabs.length === 0) return;
      const target = last ? tabs[tabs.length - 1] : tabs[index];
      if (target) navigateToTab(navigate, target);
    },
    [navigate],
  );

  const stepTab = useCallback(
    (direction: 1 | -1) => {
      const tabs = useTableTabs.getState().tabs;
      if (tabs.length < 2) return;
      const current = activeKey ? tabs.findIndex((tab) => tabKey(tab) === activeKey) : -1;
      const next = current === -1 ? 0 : (current + direction + tabs.length) % tabs.length;
      const target = tabs[next];
      if (target) navigateToTab(navigate, target);
    },
    [activeKey, navigate],
  );

  const closeActiveTab = useCallback(() => {
    const tabs = useTableTabs.getState().tabs;
    if (tabs.length === 0) return;
    const key = activeKey ?? (tabs.length > 0 ? tabKey(tabs[tabs.length - 1]) : null);
    if (!key) return;
    const index = tabs.findIndex((tab) => tabKey(tab) === key);
    useTableTabs.getState().closeTab(key);
    const remaining = useTableTabs.getState().tabs;
    if (remaining.length === 0) {
      void navigate({ to: "/" });
      return;
    }
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (next && tabKey(next) !== key) navigateToTab(navigate, next);
  }, [activeKey, navigate]);

  const reopenTab = useCallback(() => {
    const restored = useTableTabs.getState().reopenLastTab();
    if (restored) navigateToTab(navigate, restored);
  }, [navigate]);

  const newQueryTab = useCallback(() => {
    const id = useTableTabs.getState().openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  }, [navigate]);

  const openFileAsTab = useCallback(async () => {
    const id = await openSqlFileAsTab();
    if (id) void navigate({ to: "/query/$id", params: { id } });
  }, [navigate]);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const definitions = [
    { id: "tab.newQuery", action: newQueryTab },
    { id: "tab.close", action: closeActiveTab },
    { id: "tab.reopen", action: reopenTab },
    { id: "tab.next", action: () => stepTab(1) },
    { id: "tab.prev", action: () => stepTab(-1) },
    { id: "tab.jump1", action: () => goToTabIndex(0) },
    { id: "tab.jump2", action: () => goToTabIndex(1) },
    { id: "tab.jump3", action: () => goToTabIndex(2) },
    { id: "tab.jump4", action: () => goToTabIndex(3) },
    { id: "tab.jump5", action: () => goToTabIndex(4) },
    { id: "tab.jump6", action: () => goToTabIndex(5) },
    { id: "tab.jump7", action: () => goToTabIndex(6) },
    { id: "tab.jump8", action: () => goToTabIndex(7) },
    { id: "tab.last", action: () => goToTabIndex(0, true) },
    { id: "app.refresh", action: handleRefresh },
    { id: "go.home", action: () => void navigate({ to: "/" }) },
    { id: "go.back", action: () => router.history.back() },
    { id: "go.forward", action: () => router.history.forward() },
    { id: "go.connections", action: () => void navigate({ to: "/connections" }) },
    { id: "settings.open", action: () => void navigate({ to: "/settings" }) },
    {
      id: "view.split",
      action: () => emitHotkeyAction("view.split"),
    },
    {
      id: "objects.search",
      action: () => emitHotkeyAction("objects.search"),
      requiresConnection: true,
    },
    {
      id: "query.openFile",
      action: () => void openFileAsTab(),
    },
    {
      id: "query.saveAs",
      action: () => emitHotkeyAction("query.saveAs"),
    },
    {
      id: "app.focusSearch",
      action: () => emitHotkeyAction("app.focusSearch"),
    },
  ];

  const definitionsRef = useRef(definitions);
  definitionsRef.current = definitions;

  useEffect(() => {
    const listener = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const entry = definitionsRef.current.find((definition) => definition.id === id);
      entry?.action();
    };
    window.addEventListener(HOTKEY_ACTION_EVENT, listener);
    return () => window.removeEventListener(HOTKEY_ACTION_EVENT, listener);
  }, []);

  useHotkeys(
    definitions.flatMap((entry) => {
      const command = commandById(entry.id);
      if (!command) return [];
      const baseEnabled = entry.requiresConnection ? connection !== null : true;
      const primary = (overrides[entry.id] ?? command.defaultHotkey) as never;
      const rows = [
        {
          hotkey: primary,
          callback: () => entry.action(),
          options: {
            enabled:
              entry.id === "app.refresh" && !overrides[entry.id]
                ? baseEnabled && !(inQueryRoute && connection !== null)
                : baseEnabled,
            ignoreInputs: command.ignoreInputs ?? false,
            preventDefault: true,
            stopPropagation: true,
          },
        },
      ];
      if (!overrides[entry.id]) {
        for (const alias of command.aliases ?? []) {
          rows.push({
            hotkey: alias as never,
            callback: () => entry.action(),
            options: {
              enabled:
                entry.id === "app.refresh"
                  ? baseEnabled && !(inQueryRoute && connection !== null)
                  : baseEnabled,
              ignoreInputs: command.ignoreInputs ?? false,
              preventDefault: true,
              stopPropagation: true,
            },
          });
        }
      }
      return rows;
    }),
    { preventDefault: true, stopPropagation: true },
  );

  return null;
}
