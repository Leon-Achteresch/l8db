import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect } from "react";
import { useResolvedHotkey } from "@/lib/hotkeys";
import { openLinkFromClipboard } from "@/lib/shared-tab-open";
import { listenForSharedTabLinks } from "@/lib/shared-tab-paste";

export function SharedTabLinkHotkey() {
  const openLinkHotkey = useResolvedHotkey("tab.openLink");
  useHotkey(openLinkHotkey, () => void openLinkFromClipboard(), { ignoreInputs: true });
  useEffect(listenForSharedTabLinks, []);
  return null;
}
