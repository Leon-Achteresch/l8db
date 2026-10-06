import { ContextMenu as ContextMenuPrimitive, Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { ContextMenuLazyContext } from "./context-menu-lazy";

export function ContextMenuTrigger({
  className,
  highlight = true,
  asChild,
  ref,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger> & {
  highlight?: boolean;
}) {
  const lazy = React.useContext(ContextMenuLazyContext);
  const nodeRef = React.useRef<HTMLSpanElement | null>(null);
  const setRef = React.useCallback(
    (node: HTMLSpanElement | null) => {
      nodeRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  React.useLayoutEffect(() => {
    const point = lazy?.pending.current;
    const node = nodeRef.current;
    if (!lazy?.live || !point || !node) return;
    lazy.pending.current = null;
    node.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  }, [lazy]);

  const classes = cn("select-none", highlight && "context-menu-target", className);
  if (lazy && !lazy.live) {
    const Comp = asChild ? Slot.Root : "span";
    return (
      <Comp
        ref={setRef}
        data-slot="context-menu-trigger"
        data-state="closed"
        className={classes}
        {...props}
        onContextMenu={(event: React.MouseEvent<HTMLSpanElement>) => {
          props.onContextMenu?.(event);
          if (event.defaultPrevented || props.disabled) return;
          event.preventDefault();
          event.stopPropagation();
          lazy.arm({ x: event.clientX, y: event.clientY });
        }}
      />
    );
  }
  return (
    <ContextMenuPrimitive.Trigger
      ref={setRef}
      asChild={asChild}
      data-slot="context-menu-trigger"
      className={classes}
      {...props}
    />
  );
}
