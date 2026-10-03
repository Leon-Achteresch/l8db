import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { IslandElapsed } from "@/features/shell/dynamic-island/island-elapsed";
import { IslandSymbol } from "@/features/shell/dynamic-island/island-symbol";
import { useIslandMoments } from "@/features/shell/dynamic-island/use-island-moments";
import { useIslandView } from "@/features/shell/dynamic-island/use-island-view";
import { dismissIslandMoment, type IslandTone, useIslandStore } from "@/lib/dynamic-island";
import { EASE_OUT } from "@/lib/ease";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { cn } from "@/lib/utils";

const ISLAND_SPRING = { type: "spring", stiffness: 420, damping: 26, mass: 0.9 } as const;
const IDLE_WIDTH = 180;
const ACTIVE_WIDTH = 220;
const TONE_GLOW: Record<IslandTone, string> = {
  neutral: "",
  success: "shadow-[0_0_0_1px_rgb(52_211_153/0.45),0_0_18px_-2px_rgb(52_211_153/0.5)]",
  error: "shadow-[0_0_0_1px_rgb(248_113_113/0.5),0_0_18px_-2px_rgb(248_113_113/0.5)]",
  warning: "shadow-[0_0_0_1px_rgb(251_191_36/0.45),0_0_18px_-2px_rgb(251_191_36/0.45)]",
  celebrate: "shadow-[0_0_0_1px_rgb(232_121_249/0.45),0_0_22px_-2px_rgb(167_139_250/0.6)]",
};

interface Props {
  buttonRef: RefObject<HTMLButtonElement | null>;
  shortcut: string;
  onOpen: () => void;
}

export function DynamicIsland({ buttonRef, shortcut, onOpen }: Props) {
  useIslandMoments();
  const view = useIslandView();
  const frame = useElementSize<HTMLDivElement>();
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const current = useRef<HTMLDivElement | null>(null);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    current.current = node;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.target === current.current)
        setWidth(Math.ceil(entry.borderBoxSize[0]?.inlineSize ?? 0));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => useIslandStore.setState({ queue: [] }), []);

  useEffect(() => {
    if (!view.duration || hovered) return;
    const timer = window.setTimeout(() => dismissIslandMoment(view.key), view.duration);
    return () => window.clearTimeout(timer);
  }, [view, hovered]);

  const max = frame.width || undefined;
  const trailing =
    view.idle ||
    view.since !== undefined ||
    view.percent !== undefined ||
    Boolean(view.more) ||
    Boolean(view.action);
  const announcement = view.idle ? "" : [view.title, view.detail].filter(Boolean).join(", ");

  return (
    <div ref={frame.ref} className="flex w-full justify-center">
      <motion.div
        data-tour="header-search"
        data-toast-origin
        initial={false}
        animate={{ width: width ? Math.min(width, max ?? width) : undefined }}
        transition={ISLAND_SPRING}
        whileTap={{ scale: 0.96 }}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        className={cn(
          "relative flex h-7 max-w-full items-center justify-center overflow-hidden rounded-full bg-card text-foreground shadow-xs ring-1 ring-border",
          "transition-[background-color,box-shadow] duration-300 hover:bg-muted dark:bg-black dark:text-white dark:ring-white/10 dark:hover:bg-neutral-900",
          TONE_GLOW[view.tone ?? "neutral"],
        )}
      >
        <button
          ref={buttonRef}
          type="button"
          aria-label={view.label ?? (announcement ? `Suchen · ${announcement}` : "Suchen")}
          onClick={() => {
            if (view.duration) dismissIslandMoment(view.key);
            onOpen();
          }}
          className="absolute inset-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        />
        <div className="pointer-events-none grid place-items-center">
          <AnimatePresence initial={false}>
            <motion.div
              key={view.key}
              ref={measure}
              initial={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{
                opacity: 0,
                scale: 0.9,
                filter: "blur(6px)",
                transition: { duration: 0.16, ease: EASE_OUT },
              }}
              transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.05 }}
              style={{
                maxWidth: max,
                minWidth: Math.min(view.idle ? IDLE_WIDTH : ACTIVE_WIDTH, max ?? Infinity),
              }}
              className="col-start-1 row-start-1 flex h-7 w-max items-center justify-center gap-2 px-2.5 text-xs @max-[8rem]/header-search:px-1.5"
            >
              <IslandSymbol glyph={view.glyph} />
              <span className="min-w-0 truncate font-medium @max-[8rem]/header-search:hidden">
                {view.title}
              </span>
              {view.detail ? (
                <span className="min-w-0 truncate text-current/55 @max-[14rem]/header-search:hidden">
                  {view.detail}
                </span>
              ) : null}
              {trailing ? (
                <span className="ml-auto flex shrink-0 items-center gap-1.5 @max-[8rem]/header-search:hidden">
                  {view.since !== undefined ? <IslandElapsed since={view.since} /> : null}
                  {view.percent !== undefined ? (
                    <NumberFlow
                      value={view.percent / 100}
                      locales="de-DE"
                      format={{ style: "percent" }}
                      className="text-[11px] text-current/70 tabular-nums"
                    />
                  ) : null}
                  {view.more ? (
                    <span className="rounded-full bg-current/15 px-1.5 text-[10px] font-medium leading-4">
                      +{view.more}
                    </span>
                  ) : null}
                  {view.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        view.action?.run();
                        dismissIslandMoment(view.key);
                      }}
                      className="pointer-events-auto -mr-1 h-5 cursor-pointer rounded-full bg-current/15 px-2 text-[11px] font-medium transition-colors hover:bg-current/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {view.action.label}
                    </button>
                  ) : null}
                  {view.idle ? (
                    <kbd className="inline-flex items-center rounded-full bg-current/10 px-1.5 py-px font-sans text-[10px] text-current/60">
                      {shortcut}
                    </kbd>
                  ) : null}
                </span>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </motion.div>
    </div>
  );
}
