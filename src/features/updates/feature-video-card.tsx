import { Link } from "@tanstack/react-router";
import { ArrowRight, Expand, Minimize2, Pause, Play, RotateCcw, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EASE_OUT } from "@/lib/ease";
import type { FeatureVideo } from "@/lib/feature-videos/model";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";

interface Props {
  item: FeatureVideo;
  suspended: boolean;
  next: FeatureVideo | undefined;
  preview?: { onClose: () => void };
}

export function FeatureVideoCard({ item, suspended, next, preview }: Props) {
  const reduce = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [wantsPlay, setWantsPlay] = useState(!reduce);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sourceIndex, setSourceIndex] = useState(0);
  const offered = useRef(false);
  const seen = useRef(false);
  const sources = useRef(item.sources);
  const mark = useFeatureVideoStore((s) => s.mark);
  const close = useFeatureVideoStore((s) => s.close);
  const open = useFeatureVideoStore((s) => s.open);
  const dismiss = () => {
    if (preview) {
      preview.onClose();
      return;
    }
    mark(item.id, "dismissed");
    close();
  };
  const to =
    item.actionId === "settings"
      ? "/settings"
      : item.actionId === "extensions"
        ? "/settings"
        : "/compare";

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const preferred = item.sources.findIndex((source) => video.canPlayType(source.type));
    sources.current =
      preferred > 0
        ? [item.sources[preferred], ...item.sources.filter((_, index) => index !== preferred)]
        : item.sources;
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [item]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let alive = true;
    const source = sources.current[sourceIndex];
    if (video.getAttribute("src") !== source.url) video.src = source.url;
    if (suspended || !wantsPlay || failed) video.pause();
    else
      void video.play().catch((error: unknown) => {
        if (alive && error instanceof DOMException && error.name === "NotAllowedError")
          setWantsPlay(false);
      });
    return () => {
      alive = false;
    };
  }, [suspended, wantsPlay, failed, sourceIndex]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--feature-video-height",
        suspended ? "0px" : `${card.getBoundingClientRect().height + 12}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--feature-video-height");
    };
  }, [suspended]);

  const toggle = () => {
    if (ended) {
      if (videoRef.current) videoRef.current.currentTime = 0;
      setEnded(false);
    }
    setWantsPlay((value) => !value || ended);
  };

  return (
    <motion.aside
      ref={cardRef}
      data-feature-video
      aria-label={`Neues Feature: ${item.title}`}
      aria-hidden={suspended}
      inert={suspended}
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: suspended ? 0 : 1, y: 0, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          dismiss();
        }
      }}
      className="fixed right-4 bottom-11 z-40 overflow-x-hidden overflow-y-auto rounded-[24px] border border-border/70 bg-card text-card-foreground shadow-xl shadow-foreground/10"
      style={{
        width: expanded
          ? "min(720px, calc(100vw - 32px), calc((100dvh - 280px) * 16 / 9))"
          : "min(380px, calc(100vw - 32px))",
        maxHeight: "calc(100dvh - 60px)",
        visibility: suspended ? "hidden" : "visible",
      }}
    >
      <div className="relative aspect-video bg-muted">
        {preview ? (
          <img src={item.poster} alt={item.title} className="h-full w-full object-contain" />
        ) : (
          <video
            ref={videoRef}
            className="h-full w-full object-contain"
            muted
            playsInline
            preload="none"
            poster={item.poster}
            aria-label={item.title}
            onPlaying={() => {
              if (suspended) {
                videoRef.current?.pause();
                return;
              }
              setPlaying(true);
              if (!offered.current) {
                offered.current = true;
                mark(item.id, "offered");
              }
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setEnded(true);
              setWantsPlay(false);
              setPlaying(false);
              mark(item.id, "seen");
            }}
            onTimeUpdate={() => {
              const video = videoRef.current;
              if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
              const fraction = video.currentTime / video.duration;
              setProgress(fraction);
              if (!suspended && fraction >= 0.8 && !seen.current) {
                seen.current = true;
                mark(item.id, "seen");
              }
            }}
            onError={() => {
              const video = videoRef.current;
              if (video && sourceIndex + 1 < sources.current.length) {
                video.src = sources.current[sourceIndex + 1].url;
                setSourceIndex((index) => index + 1);
              } else {
                setFailed(true);
                setWantsPlay(false);
              }
            }}
          />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          aria-label="Feature-Video schließen"
          className="absolute top-3 right-3 z-10 size-8 rounded-full bg-foreground/75 text-background shadow-sm backdrop-blur-sm hover:bg-foreground/90 focus-visible:ring-ring dark:bg-background/75 dark:text-foreground dark:hover:bg-background/90"
        >
          <X className="size-4" />
        </Button>
        {!preview && (!playing || failed) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/35">
            {failed ? (
              <p role="status" className="max-w-64 rounded-lg bg-card p-3 text-center text-xs">
                Video gerade nicht verfügbar. Die Beschreibung findest du in den Release Notes.
              </p>
            ) : (
              <Button
                variant="secondary"
                size="icon"
                className="size-12 rounded-full shadow-lg"
                onClick={toggle}
                aria-label={ended ? "Video wiederholen" : "Video abspielen"}
              >
                {ended ? <RotateCcw className="size-5" /> : <Play className="size-5" />}
              </Button>
            )}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-background/40">
          <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="px-4 pt-4 pb-3.5">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            <span>Neu in l8db</span>
            <span aria-hidden="true">·</span>
            <span>{item.releaseVersion}</span>
          </div>
          <h2 className="text-[15px] font-semibold leading-snug tracking-tight">{item.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.summary}</p>
        </div>
        <div className="mt-4 flex items-center gap-1 border-t border-border/60 pt-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={toggle}
            disabled={failed || !!preview}
            title={preview ? "Bildvorschau ohne Videowiedergabe" : undefined}
            aria-label={playing ? "Video pausieren" : "Video abspielen"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {Math.round(item.durationSeconds * progress)} / {Math.round(item.durationSeconds)} s
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Video verkleinern" : "Video vergrößern"}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Expand className="size-4" />}
          </Button>
          <div className="flex-1" />
          {ended && next ? (
            <Button
              size="sm"
              className="h-8 rounded-lg px-2.5 text-xs"
              onClick={() => open(next.id, true)}
            >
              Nächstes Feature
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <Button size="sm" className="h-8 rounded-lg px-2.5 text-xs" asChild>
              <Link
                to={failed ? "/release-notes" : to}
                search={
                  failed
                    ? {}
                    : item.actionId === "extensions"
                      ? { tab: "extensions" }
                      : item.actionId === "settings"
                        ? { tab: "general" }
                        : {}
                }
                onClick={preview ? preview.onClose : close}
              >
                {failed ? "Release Notes" : "Feature öffnen"}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
