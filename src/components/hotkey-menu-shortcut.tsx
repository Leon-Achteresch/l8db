import { ContextMenuShortcut } from "@/components/ui/context-menu";
import { formatMenuShortcut, useResolvedHotkey } from "@/lib/hotkeys";

export function HotkeyMenuShortcut({ command }: { command: string }) {
  return (
    <ContextMenuShortcut>{formatMenuShortcut(useResolvedHotkey(command))}</ContextMenuShortcut>
  );
}
