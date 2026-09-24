import { Outlet, useChildMatches, useRouterState } from "@tanstack/react-router";
import { type ReactNode, startTransition, useEffect, useState } from "react";

export function DeferredOutlet({
  children = (outlet) => outlet,
}: {
  children?: (outlet: ReactNode) => ReactNode;
}) {
  const key = useChildMatches({ select: (matches) => matches[0]?.id ?? "" });
  const settled = useRouterState({
    select: (state) => state.status === "idle" && !state.isLoading,
  });
  const [shown, setShown] = useState(key);

  useEffect(() => {
    if (key !== shown && settled) startTransition(() => setShown(key));
  }, [key, shown, settled]);

  return key === shown ? children(<Outlet />) : null;
}
