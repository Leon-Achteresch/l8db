import { Outlet, useChildMatches } from "@tanstack/react-router";
import { startTransition, useEffect, useState } from "react";

export function DeferredOutlet() {
  const key = useChildMatches({ select: (matches) => matches[0]?.id ?? "" });
  const [shown, setShown] = useState(key);

  useEffect(() => {
    if (key !== shown) startTransition(() => setShown(key));
  }, [key, shown]);

  return key === shown ? <Outlet /> : null;
}
