import * as React from "react";

export function DialogFocusOrigin({ origin }: { origin: React.RefObject<HTMLElement | null> }) {
  React.useState(() => {
    origin.current = document.activeElement as HTMLElement | null;
  });
  return null;
}
