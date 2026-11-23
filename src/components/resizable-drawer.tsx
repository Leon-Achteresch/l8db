import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { IconButton } from "@/components/icon-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { WidthHandle } from "@/components/width-handle";

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
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const max = Math.min(860, viewportWidth - 24);
  const min = Math.min(280, max);
  const currentWidth = Math.min(max, Math.max(min, width));
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
        <WidthHandle
          label={`Breite von ${title}`}
          controls={contentId}
          side={side}
          width={currentWidth}
          min={min}
          max={max}
          onChange={onWidthChange}
        />
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          Am Rand ziehen, um die Breite zu ändern. Die Größe wird automatisch gespeichert.
        </p>
      </SheetContent>
    </Sheet>
  );
}
