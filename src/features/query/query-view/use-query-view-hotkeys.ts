import { useHotkeys } from "@tanstack/react-hotkeys";
import { type RefObject, useEffect } from "react";

import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import {
  commandById,
  formatHotkeyDisplay,
  onHotkeyAction,
  resolveHotkey,
  useHotkeysStore,
} from "@/lib/hotkeys";

import type { RunActions } from "./use-run-actions";

interface UseQueryViewHotkeysParams {
  actions: RunActions;
  connected: boolean;
  editorApiRef: RefObject<QueryEditorApi | null>;
  handleFileSave: (saveAs: boolean) => Promise<void>;
  toggleHistory: () => void;
  openCsvExport: () => void;
}

const isInMonaco = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest?.(".monaco-editor"));
};

export function useQueryViewHotkeys({
  actions,
  connected,
  editorApiRef,
  handleFileSave,
  toggleHistory,
  openCsvExport,
}: UseQueryViewHotkeysParams) {
  const { handleRun, handleRunSelection, handleRunStatement, handleCheck } = actions;
  const hotkeyOverrides = useHotkeysStore((state) => state.overrides);
  const shortcutLabel = (id: string) => formatHotkeyDisplay(resolveHotkey(id, hotkeyOverrides));
  const hotkeyFor = (id: string, fallback: string) =>
    (hotkeyOverrides[id] ?? commandById(id)?.defaultHotkey ?? fallback) as never;

  useHotkeys(
    (["query.run", "query.runSelection", "query.runStatement", "query.check"] as const).flatMap(
      (id) => {
        const command = commandById(id);
        if (!command) return [];
        const runAction =
          id === "query.run"
            ? handleRun
            : id === "query.runSelection"
              ? handleRunSelection
              : id === "query.runStatement"
                ? handleRunStatement
                : handleCheck;
        const primary = (hotkeyOverrides[id] ?? command.defaultHotkey) as never;
        const rows = [
          {
            hotkey: primary,
            callback: (event: KeyboardEvent) => {
              if (isInMonaco(event)) return;
              if (id === "query.check") void runAction();
              else (runAction as () => void)();
            },
            options: { enabled: connected, ignoreInputs: false },
          },
        ];
        if (!hotkeyOverrides[id]) {
          for (const alias of command.aliases ?? []) {
            rows.push({
              hotkey: alias as never,
              callback: () => {
                if (id === "query.check") void runAction();
                else (runAction as () => void)();
              },
              options: { enabled: connected, ignoreInputs: false },
            });
          }
        }
        return rows;
      },
    ),
    { preventDefault: true, stopPropagation: true },
  );

  const editorCommand = (run: () => void) => (event: KeyboardEvent) => {
    if (isInMonaco(event)) return;
    run();
  };

  useHotkeys(
    [
      {
        hotkey: hotkeyFor("query.save", "Mod+S"),
        callback: editorCommand(() => void handleFileSave(false)),
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("query.saveAs", "Mod+Shift+S"),
        callback: () => void handleFileSave(true),
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("query.format", "Shift+Alt+F"),
        callback: editorCommand(() => editorApiRef.current?.format()),
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("query.comment", "Mod+/"),
        callback: editorCommand(() => editorApiRef.current?.toggleComment()),
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("query.bookmark", "Mod+Alt+B"),
        callback: editorCommand(() => editorApiRef.current?.toggleBookmark()),
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("query.nextBookmark", "F2"),
        callback: editorCommand(() => editorApiRef.current?.gotoBookmark("next")),
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("query.prevBookmark", "Shift+F2"),
        callback: editorCommand(() => editorApiRef.current?.gotoBookmark("previous")),
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("query.history", "Mod+H"),
        callback: toggleHistory,
        options: { ignoreInputs: false },
      },
      {
        hotkey: hotkeyFor("grid.export", "Mod+E"),
        callback: openCsvExport,
        options: { enabled: connected, ignoreInputs: false },
      },
    ],
    { preventDefault: true, stopPropagation: true },
  );

  useEffect(() => onHotkeyAction("query.run", handleRun), [handleRun]);
  useEffect(() => onHotkeyAction("query.runSelection", handleRunSelection), [handleRunSelection]);
  useEffect(() => onHotkeyAction("query.runStatement", handleRunStatement), [handleRunStatement]);
  useEffect(() => onHotkeyAction("query.check", () => void handleCheck()), [handleCheck]);
  useEffect(() => onHotkeyAction("query.save", () => void handleFileSave(false)), [handleFileSave]);
  useEffect(
    () => onHotkeyAction("query.saveAs", () => void handleFileSave(true)),
    [handleFileSave],
  );
  useEffect(() => onHotkeyAction("grid.export", openCsvExport), [openCsvExport]);

  return shortcutLabel;
}
