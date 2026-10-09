import { FocusScope } from "@radix-ui/react-focus-scope";
import { hideOthers } from "aria-hidden";
import { XIcon } from "lucide-react";
import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { acquireHistoryModalBoundary } from "@/lib/history-modal-boundary";
import { PortalContainerContext, usePortalContainer } from "@/lib/portal-container";
import { cn } from "@/lib/utils";

type Props = Pick<
  ComponentProps<typeof DialogContent>,
  "children" | "className" | "onCloseAutoFocus" | "aria-labelledby" | "aria-describedby"
> & { onDismiss: () => void };

export function QueryHistoryDialogContent({
  children,
  className,
  onCloseAutoFocus,
  onDismiss,
  ...props
}: Props) {
  const scopedContainer = usePortalContainer();
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const latestDismiss = useRef(onDismiss);
  latestDismiss.current = onDismiss;

  useLayoutEffect(() => {
    if (!scopedContainer || !content) return;
    const releaseBoundary = acquireHistoryModalBoundary(content, () => latestDismiss.current());
    const restoreHidden = hideOthers(content);
    return () => {
      releaseBoundary();
      restoreHidden();
    };
  }, [scopedContainer, content]);

  if (!scopedContainer)
    return (
      <DialogContent className={className} onCloseAutoFocus={onCloseAutoFocus} {...props}>
        {children}
      </DialogContent>
    );

  return createPortal(
    <>
      <div
        data-slot="dialog-overlay"
        aria-hidden="true"
        className="pointer-events-auto fixed inset-0 z-50 bg-black/10"
      />
      <FocusScope asChild loop trapped onUnmountAutoFocus={onCloseAutoFocus}>
        <div
          {...props}
          ref={setContent}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          data-slot="dialog-content"
          data-state="open"
          className={cn(
            "pointer-events-auto fixed top-1/2 left-1/2 z-50 grid w-full grid-cols-1 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-primary/15 outline-none sm:max-w-md",
            className,
          )}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }}
        >
          <PortalContainerContext value={content ?? scopedContainer}>
            {children}
          </PortalContainerContext>
          <Button
            variant="ghost"
            className="absolute top-4 right-4"
            size="icon-sm"
            onClick={onDismiss}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </div>
      </FocusScope>
    </>,
    scopedContainer,
  );
}
