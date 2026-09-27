import { useHotkeys } from "@tanstack/react-hotkeys";
import { Redo2Icon, Undo2Icon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import {
  commandById,
  formatHotkeyDisplay,
  useHotkeysStore,
  useResolvedHotkey,
} from "@/lib/hotkeys";
import { useWorkspacePane } from "@/lib/workspace-pane";

export function UndoRedoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  enabled = true,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  enabled?: boolean;
}) {
  const pane = useWorkspacePane();
  const active = enabled && (pane === null || pane.focused);
  const undoHotkey = useResolvedHotkey("edit.undo");
  const redoHotkey = useResolvedHotkey("edit.redo");
  const redoOverridden = useHotkeysStore((state) => state.overrides["edit.redo"] !== undefined);
  const redoAliases = redoOverridden ? [] : (commandById("edit.redo")?.aliases ?? []);
  const options = { enabled: active, ignoreInputs: true, preventDefault: true };

  useHotkeys([
    { hotkey: undoHotkey, callback: () => canUndo && onUndo(), options },
    ...[redoHotkey, ...redoAliases].map((hotkey) => ({
      hotkey,
      callback: () => canRedo && onRedo(),
      options,
    })),
  ]);

  return (
    <div className="flex items-center">
      <IconButton
        variant="ghost"
        size="icon-sm"
        aria-label={`Rückgängig (${formatHotkeyDisplay(undoHotkey)})`}
        disabled={!enabled || !canUndo}
        onClick={onUndo}
      >
        <Undo2Icon />
      </IconButton>
      <IconButton
        variant="ghost"
        size="icon-sm"
        aria-label={`Wiederholen (${formatHotkeyDisplay(redoHotkey)})`}
        disabled={!enabled || !canRedo}
        onClick={onRedo}
      >
        <Redo2Icon />
      </IconButton>
    </div>
  );
}
