import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";
import { clampWidth, MAX_WIDTH, MIN_WIDTH, PEEK } from "./drawer-width";

export function DrawerChrome({
  id,
  index,
  depth,
  width,
  viewport,
  onWidthChange,
  onFocus,
  onClose,
  onCloseAll,
  onOpenTab,
  title,
  subtitle,
  children,
}: {
  id: string;
  index: number;
  depth: number;
  width: number;
  viewport: number;
  onWidthChange: (width: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onCloseAll: () => void;
  onOpenTab: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const current = clampWidth(width, viewport);
  const offset = depth * PEEK;
  const scale = depth === 0 ? 1 : Math.max(0.94, 1 - depth * 0.02);
  const rotate = depth === 0 ? 0 : Math.min(14, depth * 5);
  const isBack = depth > 0;

  return (
    <section
      aria-label={title}
      data-fk-drawer={id}
      style={{
        width: current,
        zIndex: 20 + index,
        transform: isBack
          ? `translateX(${-offset}px) scale(${scale}) perspective(1600px) rotateY(${rotate}deg)`
          : "none",
        transformOrigin: "right center",
      }}
      className={cn(
        "pointer-events-auto absolute inset-y-0 right-0 flex min-h-0 flex-col overflow-hidden border-l bg-background shadow-2xl transition-transform duration-250 ease-smooth-out",
        isBack ? "rounded-l-xl brightness-[0.94]" : "rounded-l-none",
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-muted/40 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-bold text-primary">
            {index + 1}
          </span>
          <span className="truncate font-mono text-xs font-semibold">{title}</span>
          {subtitle && (
            <span className="hidden max-w-56 truncate rounded border px-1.5 py-px font-mono text-[10px] text-muted-foreground lg:inline">
              {subtitle}
            </span>
          )}
        </div>
        <IconButton
          aria-label={`${title} in Tab öffnen`}
          variant="ghost"
          size="icon-sm"
          onClick={onOpenTab}
        >
          <ExternalLinkIcon />
        </IconButton>
        {index > 0 && (
          <button
            type="button"
            onClick={onCloseAll}
            className="shrink-0 cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Alle
          </button>
        )}
        <IconButton
          aria-label={`${title} schließen`}
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
        >
          <XIcon />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      {isBack && (
        <button
          type="button"
          aria-label={`${title} in den Vordergrund holen`}
          onClick={onFocus}
          className="absolute inset-0 cursor-pointer bg-transparent"
        />
      )}
      <div
        role="separator"
        tabIndex={0}
        aria-label={`Breite von ${title}`}
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={Math.min(MAX_WIDTH, viewport - 64)}
        aria-valuenow={Math.round(current)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          drag.current = { x: event.clientX, width: current };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current) onWidthChange(drag.current.width - (event.clientX - drag.current.x));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onWidthChange(current + (event.key === "ArrowLeft" ? 24 : -24));
          }
        }}
        className="absolute inset-y-0 -left-2 z-10 flex w-4 touch-none cursor-col-resize items-center justify-center outline-none hover:bg-primary/10 focus-visible:bg-primary/15"
      >
        <span className="h-14 w-1 rounded-full bg-border" />
      </div>
    </section>
  );
}
