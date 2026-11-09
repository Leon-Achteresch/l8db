import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { splitHotkeyForKbd, useResolvedHotkey } from "@/lib/hotkeys";

export function HotkeyKbd({ command }: { command: string }) {
  return (
    <KbdGroup>
      {splitHotkeyForKbd(useResolvedHotkey(command)).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
