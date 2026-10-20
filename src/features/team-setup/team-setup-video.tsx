import { MousePointer2, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EASE_OUT } from "@/lib/ease";
import { useInView } from "@/lib/hooks/use-in-view";
import { cn } from "@/lib/utils";

export interface TeamSetupScene {
  app: string;
  url: string;
  nav?: string[];
  active?: string;
  title: string;
  fields?: [string, string][];
  rows?: string[];
  action?: string;
  caption: string;
}

const SCENE_MS = 4200;

export function TeamSetupVideo({ title, scenes }: { title: string; scenes: TeamSetupScene[] }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!reduce);
  const [ended, setEnded] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref, null, "0px");
  const running = playing && visible;
  const last = index === scenes.length - 1;
  const scene = scenes[index];

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      if (!last) return setIndex(index + 1);
      setPlaying(false);
      setEnded(true);
    }, SCENE_MS);
    return () => clearTimeout(timer);
  }, [running, index, last]);

  const toggle = () => {
    if (ended) setIndex(0);
    setEnded(false);
    setPlaying(ended || !playing);
  };

  return (
    <figure
      ref={ref}
      aria-label={`Video: ${title}`}
      data-team-setup-video={running ? "playing" : "paused"}
      className="self-start overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div aria-hidden className="relative h-72 overflow-hidden bg-muted/40 p-3">
        <motion.div
          key={index}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="flex h-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm"
        >
          <div className="flex items-center gap-2 border-b bg-muted/60 px-2.5 py-1.5">
            <span className="flex gap-1">
              <span className="size-2 rounded-full bg-muted-foreground/30" />
              <span className="size-2 rounded-full bg-muted-foreground/30" />
              <span className="size-2 rounded-full bg-muted-foreground/30" />
            </span>
            <span className="min-w-0 flex-1 truncate rounded bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {scene.url}
            </span>
          </div>
          <div className="border-b px-3 py-1.5 text-[11px] font-semibold">{scene.app}</div>
          <div className="flex min-h-0 flex-1">
            {scene.nav ? (
              <ul className="w-36 shrink-0 space-y-0.5 border-r bg-muted/30 p-2 text-[10px]">
                {scene.nav.map((item) => (
                  <li
                    key={item}
                    className={cn(
                      "truncate rounded px-1.5 py-1",
                      item === scene.active
                        ? "bg-primary/12 font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="min-w-0 flex-1 space-y-2 p-3">
              <p className="truncate text-xs font-semibold">{scene.title}</p>
              {scene.fields?.map(([label, value]) => (
                <div key={label} className="space-y-0.5">
                  <p className="truncate text-[9px] text-muted-foreground">{label}</p>
                  <p className="truncate rounded border bg-background px-1.5 py-0.5 text-[10px]">
                    {value}
                  </p>
                </div>
              ))}
              {scene.rows ? (
                <ul className="divide-y rounded border text-[10px]">
                  {scene.rows.map((row) => (
                    <li key={row} className="truncate px-1.5 py-1">
                      {row}
                    </li>
                  ))}
                </ul>
              ) : null}
              {scene.action ? (
                <span className="relative inline-flex rounded bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground ring-4 ring-primary/25">
                  {scene.action}
                  <motion.span
                    initial={reduce ? false : { x: 90, y: 60, opacity: 0 }}
                    animate={{ x: 0, y: 0, opacity: 1 }}
                    transition={{ duration: 0.9, delay: 0.5, ease: EASE_OUT }}
                    className="absolute top-1/2 right-1 text-foreground"
                  >
                    <MousePointer2 className="size-4 fill-background" />
                  </motion.span>
                </span>
              ) : null}
            </div>
          </div>
        </motion.div>
      </div>
      <figcaption className="space-y-2 border-t px-3 py-2.5">
        <p aria-live="polite" className="min-h-8 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {index + 1}/{scenes.length} ·{" "}
          </span>
          {scene.caption}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={
              ended ? "Video erneut abspielen" : playing ? "Video pausieren" : "Video abspielen"
            }
            onClick={toggle}
          >
            {ended ? <RotateCcwIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <div className="flex flex-1 gap-1">
            {scenes.map((item, position) => {
              const full = position < index || (position === index && ended);
              const active = position === index && running;
              return (
                <button
                  key={item.caption}
                  type="button"
                  aria-label={`Szene ${position + 1}: ${item.caption}`}
                  aria-current={position === index ? "step" : undefined}
                  onClick={() => {
                    setIndex(position);
                    setEnded(false);
                  }}
                  className="h-4 flex-1 py-1.5"
                >
                  <span className="block h-1 overflow-hidden rounded-full bg-muted">
                    <motion.span
                      key={position === index ? `${index}-${running}` : "idle"}
                      className="block h-full origin-left bg-primary"
                      initial={{ scaleX: full ? 1 : 0 }}
                      animate={{ scaleX: full || active ? 1 : 0 }}
                      transition={{ duration: active ? SCENE_MS / 1000 : 0, ease: "linear" }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Schematische Darstellung. Die Oberfläche bei Microsoft kann leicht abweichen.
        </p>
      </figcaption>
    </figure>
  );
}
