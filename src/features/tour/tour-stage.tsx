import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TourFeaturePanel } from "@/features/tour/tour-feature-panel";
import { type MascotMood, TourMascot } from "@/features/tour/tour-mascot";
import { TourSpotlight } from "@/features/tour/tour-spotlight";
import { TourStepPanel } from "@/features/tour/tour-step-panel";
import { useTourTarget } from "@/lib/hooks/use-tour-target";
import { TOUR_MASCOT_NAME, type TourLastAnswer, type TourTurn, tourAiReady } from "@/lib/tour/ask";
import { TOUR_CHAPTERS } from "@/lib/tour/chapters";
import { type Size, tourPlacement } from "@/lib/tour/placement";
import { useSpotlightStore } from "@/lib/tour/spotlight";
import { useTourStore } from "@/lib/tour/store";

const MASCOT: Size = { width: 60, height: 68 };
const WALK = { type: "spring", stiffness: 70, damping: 16, mass: 1 } as const;
const FOLLOW = { type: "spring", stiffness: 340, damping: 34, mass: 0.8 } as const;

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function TourStage() {
  const reduce = useReducedMotion();
  const chapterIndex = useTourStore((s) => s.chapterIndex);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const detour = useTourStore((s) => s.detour);
  const selector = useSpotlightStore((s) => s.selector);
  const waiting = useSpotlightStore((s) => s.waiting);
  const rect = useTourTarget(selector);
  const step = TOUR_CHAPTERS[chapterIndex]?.steps[stepIndex];
  const bubbleRef = useRef<HTMLElement>(null);
  const history = useRef<TourTurn[]>([]);
  const lastAnswer = useRef<TourLastAnswer | null>(null);
  const [viewport, setViewport] = useState(viewportSize);
  const [bubble, setBubble] = useState<Size>({ width: 352, height: 240 });
  const [walking, setWalking] = useState(false);
  const [direction, setDirection] = useState(0);
  const [quietKey, setQuietKey] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const lastX = useRef<number | null>(null);
  const stepKey = detour ?? `${chapterIndex}:${stepIndex}`;

  useEffect(() => {
    let live = true;
    void tourAiReady().then((ready) => {
      if (live) setAiReady(ready);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewport(viewportSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const element = bubbleRef.current;
    if (!element) return;
    const update = () => {
      const width = Math.round(element.offsetWidth);
      const height = Math.round(element.offsetHeight);
      setBubble((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuietKey(stepKey), 1400);
    return () => window.clearTimeout(timer);
  }, [stepKey]);

  const placement = useMemo(
    () =>
      tourPlacement({
        target: rect,
        viewport,
        mascot: MASCOT,
        bubble,
        preferred: detour ? undefined : step?.side,
      }),
    [rect, viewport, bubble, detour, step?.side],
  );

  useEffect(() => {
    const previous = lastX.current;
    lastX.current = placement.mascot.x;
    if (previous !== null && Math.abs(placement.mascot.x - previous) > 4)
      setDirection(Math.sign(placement.mascot.x - previous));
  }, [placement.mascot.x]);

  const mood: MascotMood = thinking
    ? "thinking"
    : step?.id === "finish" && !detour
      ? "happy"
      : quietKey !== stepKey
        ? "talking"
        : "idle";
  const tailTop = Math.min(
    Math.max(placement.mascot.y + 26 - placement.bubble.y, 14),
    Math.max(14, bubble.height - 26),
  );

  return (
    <>
      <TourSpotlight rect={rect} waiting={waiting} />
      <motion.div
        data-tour-ui="mascot"
        data-walking={walking || undefined}
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 z-[10000002] drop-shadow-[0_10px_18px_rgba(0,0,0,0.28)]"
        initial={
          reduce
            ? false
            : { x: viewport.width + MASCOT.width, y: viewport.height - MASCOT.height - 24 }
        }
        animate={{ x: placement.mascot.x, y: placement.mascot.y }}
        transition={reduce ? { duration: 0 } : WALK}
        onAnimationStart={() => {
          if (!reduce) setWalking(true);
        }}
        onAnimationComplete={() => setWalking(false)}
      >
        <motion.div
          animate={{ rotate: walking ? direction * 5 : 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          style={{ transformOrigin: "50% 100%" }}
        >
          <TourMascot
            mood={mood}
            walking={walking}
            look={walking ? { x: direction, y: 0 } : placement.look}
          />
        </motion.div>
      </motion.div>
      <motion.section
        ref={bubbleRef}
        data-tour-ui="overview"
        aria-label={`Tour mit ${TOUR_MASCOT_NAME}`}
        className="pointer-events-auto fixed top-0 left-0 z-[10000002] flex max-h-[calc(100dvh-2rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col rounded-2xl bg-card/95 text-card-foreground shadow-2xl ring-1 shadow-black/25 ring-border/60 backdrop-blur-xl"
        initial={
          reduce ? false : { opacity: 0, scale: 0.94, x: placement.bubble.x, y: placement.bubble.y }
        }
        animate={{ opacity: 1, scale: 1, x: placement.bubble.x, y: placement.bubble.y }}
        transition={reduce ? { duration: 0 } : FOLLOW}
        style={{ transformOrigin: placement.bubbleSide === "right" ? "0% 12%" : "100% 12%" }}
      >
        <span
          aria-hidden
          className="absolute size-3 rotate-45 rounded-[2px] bg-card"
          style={{
            top: tailTop,
            [placement.bubbleSide === "right" ? "left" : "right"]: -5,
          }}
        />
        <div className="relative flex min-h-0 flex-col overflow-hidden rounded-[inherit]">
          {detour ? (
            <TourFeaturePanel featureId={detour} />
          ) : (
            <TourStepPanel
              aiReady={aiReady}
              history={history}
              lastAnswer={lastAnswer}
              onThinking={setThinking}
            />
          )}
        </div>
      </motion.section>
    </>
  );
}
