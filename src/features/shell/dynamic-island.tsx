import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IslandElapsed } from "@/features/shell/dynamic-island/island-elapsed";
import { IslandPill } from "@/features/shell/dynamic-island/island-pill";
import { IslandSymbol } from "@/features/shell/dynamic-island/island-symbol";
import { useIslandMoments } from "@/features/shell/dynamic-island/use-island-moments";
import { useIslandView } from "@/features/shell/dynamic-island/use-island-view";
import { dismissIslandMoment, useIslandStore } from "@/lib/dynamic-island";
import { EASE_OUT } from "@/lib/ease";
import { useElementSize } from "@/lib/hooks/use-element-size";

const IDLE_WIDTH = 180;
const ACTIVE_WIDTH = 220;
const SHRINK_DELAY = 0.07;
const BACKLOG_DURATION = 1600;
const PERCENT = new Intl.NumberFormat("de-DE", { style: "percent" });

interface Props {
  buttonRef: RefObject<HTMLButtonElement | null>;
  shortcut: string;
  badge?: ReactNode;
  onOpen: () => void;
}

export function DynamicIsland({ buttonRef, shortcut, badge, onOpen }: Props) {
  useIslandMoments();
  const view = useIslandView();
  const reduce = useReducedMotion();
  const frame = useElementSize<HTMLDivElement>();
  const [pill, setPill] = useState({ width: 0, delay: 0 });
  const [hovered, setHovered] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const backlog = useIslandStore((state) => state.queue.length > 1);
  const duration =
    view.duration && backlog && !view.action
      ? Math.min(view.duration, BACKLOG_DURATION)
      : view.duration;

  useEffect(() => () => useIslandStore.setState({ queue: [] }), []);

  useLayoutEffect(() => {
    const node = stage.current?.querySelector(`[data-island="${CSS.escape(view.key)}"]`);
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = 2 * Math.ceil((entry.borderBoxSize[0]?.inlineSize ?? 0) / 2);
      setPill((previous) =>
        previous.width === width
          ? previous
          : { width, delay: width < previous.width ? SHRINK_DELAY : 0 },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [view.key]);

  useEffect(() => {
    if (!duration || hovered) return;
    const timer = window.setTimeout(() => dismissIslandMoment(view.key), duration);
    return () => window.clearTimeout(timer);
  }, [view, duration, hovered]);

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
      <div
        ref={stage}
        data-tour="header-search"
        data-toast-origin
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{ width: pill.width || undefined, WebkitAppRegion: "no-drag" } as CSSProperties}
        className="group relative h-7 max-w-full text-foreground transition-[scale] dark:text-white duration-150 ease-out active:scale-[0.96]"
      >
        {pill.width ? (
          <IslandPill width={pill.width} tone={view.tone ?? "neutral"} delay={pill.delay} />
        ) : null}
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
        <AnimatePresence initial={false}>
          <motion.div
            key={view.key}
            data-island={view.key}
            initial={{ opacity: 0, transform: reduce ? "scale(1)" : "scale(0.92)" }}
            animate={{ opacity: 1, transform: "scale(1)" }}
            exit={{
              opacity: 0,
              transform: reduce ? "scale(1)" : "scale(0.92)",
              transition: { duration: 0.1, ease: EASE_OUT },
            }}
            transition={{ duration: 0.25, ease: EASE_OUT, delay: 0.08 }}
            style={{
              maxWidth: max,
              minWidth: Math.min(view.idle ? IDLE_WIDTH : ACTIVE_WIDTH, max ?? Infinity),
            }}
            className="pointer-events-none absolute top-0 left-1/2 flex h-7 w-max -translate-x-1/2 items-center justify-center gap-2 px-2.5 text-xs @max-[8rem]/header-search:px-1.5"
          >
            <IslandSymbol glyph={view.glyph} />
            <span className="min-w-0 truncate font-medium @max-[8rem]/header-search:hidden">
              {view.title}
            </span>
            {view.idle ? badge : null}
            {view.detail ? (
              <span className="min-w-0 truncate text-current/55 @max-[14rem]/header-search:hidden">
                {view.detail}
              </span>
            ) : null}
            {trailing ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 @max-[8rem]/header-search:hidden">
                {view.since !== undefined ? <IslandElapsed since={view.since} /> : null}
                {view.percent !== undefined ? (
                  <span className="text-[11px] text-current/70 tabular-nums">
                    {PERCENT.format(view.percent / 100)}
                  </span>
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
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
    </div>
  );
}
