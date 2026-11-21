import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { splitHotkeyForKbd, useResolvedHotkey } from "@/lib/hotkeys";

export function HotkeyKbd({ command }: { command: string }) {
  const keys = splitHotkeyForKbd(useResolvedHotkey(command));
  if (keys.length === 0) return null;
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
