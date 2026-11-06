import type { MouseEvent } from "react";
import { openDetached } from "@/lib/split-view";

export function middleClick(open: (() => void) | undefined) {
  if (!open) return {};
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      openDetached(open);
    },
  };
}
