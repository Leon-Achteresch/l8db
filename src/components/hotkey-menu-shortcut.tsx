import { ContextMenuShortcut } from "@/components/ui/context-menu";
import { formatMenuShortcut, useResolvedHotkey } from "@/lib/hotkeys";

export function HotkeyMenuShortcut({ command }: { command: string }) {
  return (
    <ContextMenuShortcut data-hotkey={command}>
      {formatMenuShortcut(useResolvedHotkey(command))}
    </ContextMenuShortcut>
  );
}
