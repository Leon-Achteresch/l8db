import type { useNavigate } from "@tanstack/react-router";
import { Braces, Eye, Keyboard, NotebookPen, Package, Table } from "lucide-react";
import type { CommandItem } from "@/components/motion/command-palette";
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
      isCommandVisibleInRoute(command, pathname) &&
      isHotkeyAvailable(command.id, { hasConnection }),
  ).map((command) => ({
    id: `hotkey:${command.id}`,
    label: command.label,
    group: "Aktionen",
    icon: Keyboard,
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
      group: "Notebooks",
      icon: NotebookPen,
      keywords,
      onSelect: go(),
    },
    {
      id: "notebook:new",
      label: "Neues SQL-Notebook",
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
      group: "Notebooks",
      icon: NotebookPen,
      keywords,
      onSelect: go(async () => (await import("@/lib/notebook/actions")).openNotebook()),
    },
    ...recent.map((entry) => ({
      id: `notebook:recent:${entry.path}`,
      label: entry.name,
      group: "Notebooks",
      icon: NotebookPen,
      hint: entry.path.split(/[\\/]/).pop(),
      keywords: [...keywords, entry.path],
      onSelect: go(async () => (await import("@/lib/notebook/actions")).openNotebook(entry.path)),
    })),
  ];
}
