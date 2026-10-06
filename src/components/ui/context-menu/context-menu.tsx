import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";
import { ContextMenuLazyContext, type ContextMenuPoint } from "./context-menu-lazy";

export function ContextMenu({
  eager = false,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root> & { eager?: boolean }) {
  const [armed, setArmed] = React.useState(eager);
  const pending = React.useRef<ContextMenuPoint | null>(null);
  const live = eager || armed;
  const lazy = React.useMemo(
    () => ({
      live,
      pending,
      arm: (point: ContextMenuPoint) => {
        pending.current = point;
        setArmed(true);
      },
    }),
    [live],
  );
  return (
    <ContextMenuLazyContext.Provider value={lazy}>
      {live ? (
        <ContextMenuPrimitive.Root data-slot="context-menu" {...props}>
          {children}
        </ContextMenuPrimitive.Root>
      ) : (
        children
      )}
    </ContextMenuLazyContext.Provider>
  );
}
