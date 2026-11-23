import { useRef } from "react";
import { cn } from "@/lib/utils";

export function WidthHandle({
  label,
  controls,
  side,
  width,
  min,
  max,
  onChange,
  className,
}: {
  label: string;
  controls?: string;
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  className?: string;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (value: number) => onChange(Math.max(min, Math.min(max, value)));
  const direction = side === "left" ? 1 : -1;
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.width + (event.clientX - drag.current.x) * direction);
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
          resize(width + (event.key === "ArrowRight" ? 20 : -20) * direction);
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
        className,
      )}
    >
      <span className="h-12 w-1 rounded-full bg-border" />
    </div>
  );
}
