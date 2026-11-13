import { lazy, Suspense, useEffect, useState } from "react";
import {
  CHEATSHEET_COMMAND,
  dialogOpen,
  isEditableTarget,
  matchesCheatsheetKey,
} from "@/lib/discovery/cheatsheet/cheatsheet";
import { onHotkeyAction } from "@/lib/hotkeys/actions";
import { detectHotkeyPlatform } from "@/lib/hotkeys/display";
import { resolveHotkey } from "@/lib/hotkeys/use-hotkeys-store";

const CheatsheetDialog = lazy(() =>
  import("./cheatsheet-dialog").then((module) => ({ default: module.CheatsheetDialog })),
);

export function CheatsheetHost() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const platform = detectHotkeyPlatform();
    const show = () => {
      setMounted(true);
      setOpen(true);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (!matchesCheatsheetKey(event, resolveHotkey(CHEATSHEET_COMMAND), platform)) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      if (dialogOpen()) return;
      event.preventDefault();
      show();
    };
    window.addEventListener("keydown", keydown);
    const stopAction = onHotkeyAction(CHEATSHEET_COMMAND, show);
    return () => {
      window.removeEventListener("keydown", keydown);
      stopAction();
    };
  }, []);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <CheatsheetDialog open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
