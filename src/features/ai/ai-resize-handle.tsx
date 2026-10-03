import { useRef } from "react";
import { useAiStore } from "@/lib/ai/store";

export function AiResizeHandle() {
  const width = useAiStore((state) => state.width);
  const setWidth = useAiStore((state) => state.setWidth);
  const start = useRef<{ x: number; width: number } | null>(null);
  const update = (value: number) =>
    setWidth(Math.min(Math.max(320, window.innerWidth - 320), value));
  return (
    <button
      type="button"
      role="separator"
      tabIndex={0}
      aria-label="AI-Panelbreite anpassen"
      aria-orientation="vertical"
      aria-controls="ai-workspace"
      aria-valuemin={320}
      aria-valuemax={760}
      aria-valuenow={Math.round(width)}
      className="group relative my-2 w-3 shrink-0 cursor-col-resize touch-none self-stretch select-none rounded-full border-0 bg-transparent outline-none hover:bg-muted-foreground/10 focus-visible:bg-primary/15"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (start.current) update(start.current.width + start.current.x - event.clientX);
      }}
      onPointerUp={(event) => {
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onDoubleClick={() => update(420)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 16;
        if (event.key === "ArrowLeft") update(width + step);
        else if (event.key === "ArrowRight") update(width - step);
        else if (event.key === "Home") update(320);
        else if (event.key === "End") update(760);
        else return;
        event.preventDefault();
      }}
    >
      <span className="pointer-events-none absolute top-1/2 left-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border group-hover:bg-muted-foreground/50 group-focus-visible:bg-primary" />
    </button>
  );
}
