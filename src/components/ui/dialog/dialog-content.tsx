"use client";

import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DialogFocusOrigin } from "./dialog-focus-origin";
import { DialogOverlay } from "./dialog-overlay";
import { DialogPortal } from "./dialog-portal";

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  overlayClassName?: string;
}) {
  const returnTo = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full grid-cols-1 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-primary/15 ease-smooth-out data-open:duration-250 data-closed:duration-150 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-96 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-96",
          className,
        )}
        onCloseAutoFocus={(event) => {
          const target = returnTo.current;
          returnTo.current = null;
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          if (!target || target === document.body || !target.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
        {...props}
      >
        <DialogFocusOrigin origin={returnTo} />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" tabIndex={0}>
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
