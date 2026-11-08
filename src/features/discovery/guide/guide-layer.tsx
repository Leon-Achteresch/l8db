import { MousePointer2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { nextGuideStep, stopGuide, useGuide } from "@/lib/discovery/guide";
import { isAnchorVisible } from "@/lib/discovery/highlight";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

const PADDING = 6;
const BUBBLE_WIDTH = 288;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };
}

function bubblePosition(box: Box | null): { top: number; left: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!box) return { top: height - 200, left: Math.max(16, (width - BUBBLE_WIDTH) / 2) };
  const below = box.top + box.height + 12;
  const top = below + 160 < height ? below : Math.max(16, box.top - 172);
  const left = Math.min(Math.max(16, box.left), Math.max(16, width - BUBBLE_WIDTH - 16));
  return { top, left };
}

export function GuideLayer() {
  const guide = useGuide();
  const reduced = useReducedMotion();
  const [box, setBox] = useState<Box | null>(null);
  const origin = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.guide");
  const element = guide?.element ?? null;

  useEffect(() => {
    if (!element) {
      setBox(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      if (isAnchorVisible(element)) setBox(measure(element));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(element);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [element]);

  useEffect(() => {
    if (box) origin.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, [box]);

  if (!guide) return null;
  const step = guide.steps[guide.index];
  const last = guide.index === guide.steps.length - 1;
  const target = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  const from = origin.current;
  const position = bubblePosition(box);

  return createPortal(
    <>
      {box && (
        <div
          className="pointer-events-none fixed z-[210] rounded-xl ring-2 ring-primary transition-[top,left,width,height] duration-200"
          style={box}
        />
      )}
      {target && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-[212] text-primary drop-shadow"
          initial={reduced ? false : { x: from.x, y: from.y }}
          animate={{
            x: target.x,
            y: target.y,
            scale: guide.phase === "pointing" && guide.autoClick ? [1, 0.85, 1] : 1,
          }}
          transition={reduced ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <MousePointer2 className="size-6 fill-primary/30" />
        </motion.div>
      )}
      <div
        ref={ref}
        role="dialog"
        aria-label="Zeig's mir"
        className="fixed z-[213] w-72 space-y-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl"
        style={position}
      >
        <div aria-live="polite" className="space-y-1">
          <p className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            {guide.title}
            {isNew && <NewBadge />}
          </p>
          <p className="text-sm font-semibold">{step?.title}</p>
          {step?.body && <p className="text-xs text-muted-foreground">{step.body}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex gap-1"
            role="progressbar"
            aria-valuenow={guide.index + 1}
            aria-valuemax={guide.steps.length}
            aria-valuemin={1}
          >
            {guide.steps.map((entry, index) => (
              <span
                key={`${entry.anchor}-${String(index)}`}
                className={cn(
                  "size-1.5 rounded-full bg-muted-foreground/30",
                  index <= guide.index && "bg-primary",
                )}
              />
            ))}
          </div>
          <div className="ml-auto flex gap-1">
            <Button size="xs" variant="ghost" className="cursor-pointer" onClick={stopGuide}>
              Beenden
            </Button>
            {!guide.manual && (
              <Button size="xs" className="cursor-pointer" onClick={nextGuideStep}>
                {last ? "Fertig" : "Weiter"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
