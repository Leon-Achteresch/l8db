import { useNavigate, useRouter } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppHotkeyBindings } from "@/features/shell/app-hotkey-bindings";
import { useActiveConnection } from "@/lib/connections";
import { openAppWindow } from "@/lib/db";
import { isEasyModeTabVisible } from "@/lib/easy-mode";
import { openSqlFileAsTab } from "@/lib/hooks/use-query-file";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { emitHotkeyAction, HOTKEY_ACTION_EVENT, useHotkeysStore } from "@/lib/hotkeys";
import { useRefreshConnection } from "@/lib/queries";
import { UI_SCALE_STEP, useSettingsStore } from "@/lib/settings";
import { navigateToTab } from "@/lib/tab-navigation";
import { queryNeedsCloseConfirmation, tabKey, useTableTabs } from "@/lib/table-tabs";
import { checkForUpdates, presentUpdate } from "@/lib/updater";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

async function checkUpdatesFromMenu() {
  try {
    const update = await checkForUpdates();
    if (!update) {
      toast.success("l8db ist auf dem neuesten Stand");
      return;
    }
    const { skippedUpdateVersion, setSkippedUpdateVersion } = useSettingsStore.getState();
    if (skippedUpdateVersion === update.version) setSkippedUpdateVersion(null);
    presentUpdate(update);
  } catch {
    toast.error("Update-Prüfung fehlgeschlagen");
  }
}

export function AppHotkeys() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const navigate = useNavigate();
  const router = useRouter();
  const inQueryRoute = useRouterSelect((state) => state.location.pathname.startsWith("/query"));
  const activeTab = useActiveWorkspaceTab();
  const connection = useActiveConnection();
  const { refresh } = useRefreshConnection();
  const overrides = useHotkeysStore((state) => state.overrides);

  const activeKey = activeTab ? tabKey(activeTab) : null;

  const goToTabIndex = useCallback(
    (index: number, last = false) => {
      const tabs = useTableTabs
        .getState()
        .tabs.filter((tab) => isEasyModeTabVisible(tab, easyMode));
      if (tabs.length === 0) return;
      const target = last ? tabs[tabs.length - 1] : tabs[index];
      if (target) navigateToTab(navigate, target);
    },
    [navigate, easyMode],
  );

  const stepTab = useCallback(
    (direction: 1 | -1) => {
      const tabs = useTableTabs
        .getState()
        .tabs.filter((tab) => isEasyModeTabVisible(tab, easyMode));
      if (tabs.length < 2) return;
      const current = activeKey ? tabs.findIndex((tab) => tabKey(tab) === activeKey) : -1;
      const next = current === -1 ? 0 : (current + direction + tabs.length) % tabs.length;
      const target = tabs[next];
      if (target) navigateToTab(navigate, target);
    },
    [activeKey, navigate, easyMode],
  );

  const closeActiveTab = useCallback(() => {
    const tabs = useTableTabs.getState().tabs.filter((tab) => isEasyModeTabVisible(tab, easyMode));
    if (tabs.length === 0) return;
    const key = activeKey ?? (tabs.length > 0 ? tabKey(tabs[tabs.length - 1]) : null);
    if (!key) return;
    const index = tabs.findIndex((tab) => tabKey(tab) === key);
    const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
    if (tab?.kind === "query" && queryNeedsCloseConfirmation(tab)) {
      window.dispatchEvent(new CustomEvent("l8db:request-close-tab", { detail: key }));
      return;
    }
    const close = () => useTableTabs.getState().closeTab(key);
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (!next) {
      void navigate({ to: "/" }).finally(close);
      return;
    }
    if (tabKey(next) === key) {
      close();
      return;
    }
    void Promise.resolve(navigateToTab(navigate, next)).finally(close);
  }, [activeKey, navigate, easyMode]);

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

  const zoom = useCallback((delta: number | null) => {
    const { uiScale, setUiScale } = useSettingsStore.getState();
    setUiScale(delta === null ? 100 : uiScale + delta);
  }, []);

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
      id: "window.new",
      action: () =>
        void openAppWindow().catch((error) =>
          toast.error(`Fenster konnte nicht geöffnet werden: ${String(error)}`),
        ),
    },
    { id: "view.zoomIn", action: () => zoom(UI_SCALE_STEP) },
    { id: "view.zoomOut", action: () => zoom(-UI_SCALE_STEP) },
    { id: "view.zoomReset", action: () => zoom(null) },
    { id: "menu.about", action: () => void navigate({ to: "/about" }) },
    { id: "menu.docs", action: () => void navigate({ to: "/docs" }) },
    { id: "menu.releaseNotes", action: () => void navigate({ to: "/release-notes" }) },
    {
      id: "menu.bugReport",
      action: () => void navigate({ to: "/settings", search: { tab: "about" } }),
    },
    { id: "menu.updates", action: () => void checkUpdatesFromMenu() },
    {
      id: "view.split",
      action: () => {
        if (!easyMode) emitHotkeyAction("view.split");
      },
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
  const [bindings] = useState(() =>
    definitions.map(({ id, requiresConnection }) => ({ id, requiresConnection })),
  );
  const run = useCallback((id: string) => {
    definitionsRef.current.find((definition) => definition.id === id)?.action();
  }, []);

  useEffect(() => {
    const listener = (event: Event) => run((event as CustomEvent<string>).detail);
    window.addEventListener(HOTKEY_ACTION_EVENT, listener);
    return () => window.removeEventListener(HOTKEY_ACTION_EVENT, listener);
  }, [run]);

  useEffect(() => {
    const unlisten = listen<string>("menu-action", (event) =>
      emitHotkeyAction(event.payload),
    ).catch(() => null);
    return () => {
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  return (
    <AppHotkeyBindings
      bindings={bindings}
      easyMode={easyMode}
      connected={connection !== null}
      overrides={overrides}
      inQueryRoute={inQueryRoute}
      run={run}
    />
  );
}
