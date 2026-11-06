import { Outlet, useChildMatches, useRouterState } from "@tanstack/react-router";
import { type ReactNode, startTransition, useEffect, useState } from "react";
import { afterPaint } from "@/lib/after-paint";

let painted = false;

export function DeferredOutlet({
  children = (outlet) => outlet,
}: {
  children?: (outlet: ReactNode) => ReactNode;
}) {
  const key = useChildMatches({ select: (matches) => matches[0]?.id ?? "" });
  const settled = useRouterState({
    select: (state) => state.status === "idle" && !state.isLoading,
  });
  const [shown, setShown] = useState<string | null>(() => (painted ? null : key));

  useEffect(() => {
    if (!painted)
      afterPaint(() => {
        painted = true;
      });
  }, []);

  useEffect(() => {
    if (shown === null) {
      let active = true;
      afterPaint(() => {
        if (active) startTransition(() => setShown(key));
      });
      return () => {
        active = false;
      };
    }
    if (key !== shown && settled) startTransition(() => setShown(key));
  }, [key, shown, settled]);

  return key === shown ? children(<Outlet />) : null;
}
