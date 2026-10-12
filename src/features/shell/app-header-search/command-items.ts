import type { useNavigate } from "@tanstack/react-router";
import {
  Braces,
  Download,
  Eye,
  GitCompare,
  Keyboard,
  NotebookPen,
  Package,
  Settings,
  Table,
} from "lucide-react";
import type { CommandItem } from "@/components/motion/command-palette";
import { SEARCH_ITEMS } from "@/features/settings/settings-search-results/search-items";
import {
  emitHotkeyAction,
  formatHotkeyDisplay,
  HOTKEY_COMMANDS,
  isCommandVisibleInRoute,
  isHotkeyAvailable,
  resolveHotkey,
} from "@/lib/hotkeys";
import type { RecentNotebook } from "@/lib/notebook/store";
import {
  buildObjectEntries,
  OBJECT_TYPE_PLURAL,
  objectEntryHint,
  objectEntryKeywords,
} from "@/lib/object-search";
import { useTableTabs } from "@/lib/table-tabs";

export function buildObjectItems(
  objects: Parameters<typeof buildObjectEntries>[0] | undefined,
  setOpen: (open: boolean) => void,
  navigate: ReturnType<typeof useNavigate>,
): CommandItem[] {
  return buildObjectEntries(objects ?? {}).map((entry) => ({
    id: entry.key,
    label: entry.name,
    kind: "object",
    group: OBJECT_TYPE_PLURAL[entry.type],
    icon:
      entry.type === "table"
        ? Table
        : entry.type === "view"
          ? Eye
          : entry.type === "package"
            ? Package
            : Braces,
    hint: objectEntryHint(entry),
    keywords: objectEntryKeywords(entry),
    onSelect: () => {
      setOpen(false);
      if (entry.type === "package") {
        void navigate({
          to: "/packages/$schema/$name",
          params: { schema: entry.schema, name: entry.name },
          search: {},
        });
        return;
      }
      if (entry.type === "procedure") {
        void navigate({
          to: "/procedures/$schema/$name",
          params: { schema: entry.schema, name: entry.name },
          search: { oid: entry.oid },
        });
        return;
      }
      if (entry.type === "routine") {
        void navigate({
          to: "/functions/$schema/$name",
          params: { schema: entry.schema, name: entry.name },
          search: { oid: entry.oid },
        });
        return;
      }
      if (entry.type === "view") {
        useTableTabs.getState().openViewEditorTab({ schema: entry.schema, view: entry.name });
        void navigate({
          to: "/view-editor/$schema/$view",
          params: { schema: entry.schema, view: entry.name },
        });
        return;
      }
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: entry.schema, table: entry.name },
      });
    },
  }));
}

export function buildHotkeyItems(
  pathname: string,
  hasConnection: boolean,
  setOpen: (open: boolean) => void,
  setShortcutsOpen: (open: boolean) => void,
  easyMode = false,
): CommandItem[] {
  return HOTKEY_COMMANDS.filter(
    (command) =>
      !(easyMode && command.id === "view.split") &&
      command.id !== "palette.open" &&
      command.id !== "palette.quickOpen" &&
      command.id !== "shortcuts.open" &&
      command.id !== "dialog.close" &&
      command.id !== "settings.search" &&
      command.id !== "go.connections" &&
      command.id !== "objects.search" &&
      isCommandVisibleInRoute(command, pathname) &&
      isHotkeyAvailable(command.id, { hasConnection }),
  ).map((command) => ({
    id: `hotkey:${command.id}`,
    label:
      command.id === "grid.export"
        ? pathname.startsWith("/query")
          ? "Ergebnis exportieren…"
          : "Tabelle exportieren…"
        : command.label,
    kind: "command",
    group: "Befehle",
    context:
      command.id === "grid.export"
        ? pathname.startsWith("/query")
          ? "Abfrage"
          : "Tabelle"
        : command.area,
    icon: command.id === "grid.export" ? Download : Keyboard,
    hint: formatHotkeyDisplay(resolveHotkey(command.id)),
    keywords: [command.id, command.area, command.description, command.reference ?? ""],
    onSelect: () => {
      setOpen(false);
      if (command.id === "shortcuts.open") {
        setShortcutsOpen(true);
        return;
      }
      emitHotkeyAction(command.id);
    },
  }));
}

export function buildNotebookItems(
  recent: RecentNotebook[],
  activeConnectionId: string | null,
  setOpen: (open: boolean) => void,
  navigate: ReturnType<typeof useNavigate>,
): CommandItem[] {
  const go = (action?: () => Promise<unknown>) => async () => {
    setOpen(false);
    if (action) await action();
    void navigate({ to: "/notebook" });
  };
  const keywords = ["notebook", "sql", "analyse", "l8nb"];
  return [
    {
      id: "notebook:show",
      label: "SQL-Notebook anzeigen",
      kind: "command",
      group: "Notebooks",
      icon: NotebookPen,
      keywords,
      onSelect: go(),
    },
    {
      id: "notebook:new",
      label: "Neues SQL-Notebook",
      kind: "command",
      group: "Notebooks",
      icon: NotebookPen,
      keywords,
      onSelect: go(async () =>
        (await import("@/lib/notebook/actions")).newNotebookDraft(activeConnectionId),
      ),
    },
    {
      id: "notebook:open",
      label: "SQL-Notebook aus Datei öffnen…",
      kind: "command",
      group: "Notebooks",
      icon: NotebookPen,
      keywords,
      onSelect: go(async () => (await import("@/lib/notebook/actions")).openNotebook()),
    },
    ...recent.map((entry) => ({
      id: `notebook:recent:${entry.path}`,
      label: entry.name,
      kind: "object" as const,
      group: "Notebooks",
      icon: NotebookPen,
      hint: entry.path.split(/[\\/]/).pop(),
      keywords: [...keywords, entry.path],
      onSelect: go(async () => (await import("@/lib/notebook/actions")).openNotebook(entry.path)),
    })),
  ];
}

export function buildCompareItems(
  hasConnection: boolean,
  setOpen: (open: boolean) => void,
  navigate: ReturnType<typeof useNavigate>,
): CommandItem[] {
  if (!hasConnection) return [];
  return [
    {
      id: "compare:new",
      label: "Neuen Vergleich erstellen…",
      kind: "command",
      group: "Befehle",
      context: "Vergleich",
      icon: GitCompare,
      featureId: "search.commands.new-compare",
      keywords: [
        "vergleich",
        "vergleichen",
        "compare",
        "diff",
        "neu",
        "erstellen",
        "quelle",
        "ziel",
      ],
      onSelect: () => {
        setOpen(false);
        const id = crypto.randomUUID();
        useTableTabs.getState().openToolTab("compare", id);
        void navigate({ to: "/compare", search: { compareId: id, setup: true } });
      },
    },
  ];
}

export function buildSettingsItems(
  setOpen: (open: boolean) => void,
  navigate: ReturnType<typeof useNavigate>,
): CommandItem[] {
  return SEARCH_ITEMS.map((setting) => ({
    id: `setting:${setting.id}`,
    label: setting.title,
    kind: "setting",
    group: "Einstellungen",
    context: setting.tabLabel,
    icon: Settings,
    keywords: [setting.description, ...setting.keywords],
    onSelect: () => {
      setOpen(false);
      void navigate({ to: "/settings", search: { tab: setting.tabId, setting: setting.id } });
    },
  }));
}

export function buildDiagramExportItems(pathname: string, hasConnection: boolean): CommandItem[] {
  if (pathname !== "/er-diagram" || !hasConnection) return [];
  return ["png", "svg", "pdf", "mermaid", "dbml"].map((format) => ({
    id: `er.export.${format}`,
    label: `ER-Diagramm als ${format === "mermaid" ? "Mermaid" : format.toUpperCase()} exportieren…`,
    kind: "command",
    group: "Befehle",
    context: "ER-Diagramm",
    icon: Download,
    keywords: ["export", "diagram", format],
    onSelect: () => emitHotkeyAction(`er.export.${format}`),
  }));
}
