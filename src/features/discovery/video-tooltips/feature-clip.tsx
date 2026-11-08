import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { pickSource, releaseVideo, resolveClip } from "@/lib/discovery/video-tooltips/media";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { cn } from "@/lib/utils";

export function FeatureClip({
  videoId,
  title,
  className,
}: {
  videoId: string | undefined;
  title: string;
  className?: string;
}) {
  const feed = useFeatureVideoStore((state) => state.feed);
  const reduce = useReducedMotion() === true;
  const clip = useMemo(() => resolveClip(videoId, feed, reduce), [videoId, feed, reduce]);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    const source = pickSource(clip.sources, (type) => video.canPlayType(type) !== "");
    if (!source) return;
    video.src = source.url;
    void video.play().catch(() => undefined);
    return () => releaseVideo(video);
  }, [clip]);

  if (!clip || failed) return null;
  return (
    <div className={cn("aspect-video overflow-hidden rounded-xl bg-muted", className)}>
      {clip.sources.length ? (
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          loop
          playsInline
          preload="none"
          poster={clip.poster}
          aria-label={title}
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          src={clip.poster}
          alt={title}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
