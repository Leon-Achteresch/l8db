import type { FeatureVideoFeed } from "@/lib/feature-videos/model";

export interface ClipSource {
  url: string;
  type: string;
}

export interface ClipMedia {
  poster: string;
  sources: ClipSource[];
}

export function resolveClip(
  videoId: string | undefined,
  feed: FeatureVideoFeed | null,
  reducedMotion: boolean,
): ClipMedia | null {
  if (!videoId || !feed) return null;
  const item = feed.items.find((entry) => entry.id === videoId);
  if (!item) return null;
  return {
    poster: item.poster,
    sources: reducedMotion ? [] : item.sources.map(({ url, type }) => ({ url, type })),
  };
}

export function pickSource(
  sources: readonly ClipSource[],
  canPlay: (type: string) => boolean,
): ClipSource | null {
  return sources.find((source) => canPlay(source.type)) ?? null;
}

export function releaseVideo(video: Pick<HTMLVideoElement, "pause" | "removeAttribute" | "load">) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}
