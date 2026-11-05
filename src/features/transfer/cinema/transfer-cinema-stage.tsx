import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { drawScene } from "./transfer-cinema-draw";
import { startEpisode } from "./transfer-cinema-episodes";
import {
  createLive,
  feedLive,
  type LiveInput,
  liveFinished,
  stepLive,
} from "./transfer-cinema-live";
import { type EpisodeKind, STAGE_H, STAGE_W } from "./transfer-cinema-sim";

export function TransferCinemaStage({
  sourceName,
  targetName,
  input,
  speed = 1,
  paused = false,
  seed = 7,
  episode,
  onFinished,
  className,
}: {
  sourceName: string;
  targetName: string;
  input: LiveInput;
  speed?: number;
  paused?: boolean;
  seed?: number;
  episode?: { kind: EpisodeKind; id: number } | null;
  onFinished?: () => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ input, speed, paused, onFinished, episode });
  live.current = { input, speed, paused, onFinished, episode };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const scene = createLive(sourceName, targetName, seed);
    let frame = 0;
    let last = performance.now();
    let reported = false;
    let forced = live.current.episode?.id ?? 0;
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const tick = (now: number) => {
      const current = live.current;
      const dt = Math.min(0.05, (now - last) / 1000) * current.speed;
      last = now;
      feedLive(scene, current.input);
      if (current.episode && current.episode.id !== forced && scene.outcome === "running") {
        forced = current.episode.id;
        scene.queue = [];
        startEpisode(scene, current.episode.kind);
      }
      if (!current.paused) {
        const steps = Math.max(1, Math.ceil(dt / (1 / 30)));
        for (let index = 0; index < steps; index++) stepLive(scene, dt / steps);
      }
      ctx.setTransform(canvas.width / STAGE_W, 0, 0, canvas.height / STAGE_H, 0, 0);
      drawScene(ctx, scene);
      if (!reported && liveFinished(scene)) {
        reported = true;
        current.onFinished?.();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [sourceName, targetName, seed]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Animation: ${sourceName} überträgt nach ${targetName}`}
      className={cn("block aspect-video w-full bg-[#f3e6d4]", className)}
    />
  );
}
