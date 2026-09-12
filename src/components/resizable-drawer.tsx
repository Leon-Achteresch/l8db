import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { IconButton } from "@/components/icon-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function ResizableDrawer({
  open,
  onOpenChange,
  side,
  title,
  description,
  width,
  onWidthChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  title: string;
  description: string;
  width: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}) {
  const contentId = useId();
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const max = Math.min(860, viewportWidth - 24);
  const min = Math.min(280, max);
  const currentWidth = Math.min(max, Math.max(min, width));
  const resize = (value: number) => onWidthChange(Math.max(min, Math.min(max, value)));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id={contentId}
        side={side}
        showCloseButton={false}
        style={{ width: currentWidth }}
        className="gap-0 data-[side=left]:sm:max-w-none data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">{description}</SheetDescription>
        </SheetHeader>
        <IconButton
          aria-label={`${title} schließen`}
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3"
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
        </IconButton>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <div
          role="separator"
          tabIndex={0}
          aria-label={`Breite von ${title}`}
          aria-orientation="vertical"
          aria-controls={contentId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={currentWidth}
          onPointerDown={(event) => {
            event.preventDefault();
            drag.current = { x: event.clientX, width: currentWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              resize(
                drag.current.width + (event.clientX - drag.current.x) * (side === "left" ? 1 : -1),
              );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              resize(
                currentWidth + (event.key === "ArrowRight" ? 20 : -20) * (side === "left" ? 1 : -1),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              resize(min);
            } else if (event.key === "End") {
              event.preventDefault();
              resize(max);
            }
          }}
          className={cn(
            "absolute inset-y-0 z-10 flex w-3 touch-none cursor-col-resize items-center justify-center outline-none hover:bg-primary/10 focus-visible:bg-primary/15",
            side === "left" ? "-right-1.5" : "-left-1.5",
          )}
        >
          <span className="h-12 w-1 rounded-full bg-border" />
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          Am Rand ziehen, um die Breite zu ändern. Die Größe wird automatisch gespeichert.
        </p>
      </SheetContent>
    </Sheet>
  );
}
