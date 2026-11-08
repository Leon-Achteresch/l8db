import { Play } from "lucide-react";
import { useState } from "react";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";

export function PaletteClipPreview({
  videoId,
  title,
  onOpen,
}: {
  videoId: string;
  title: string;
  onOpen: () => void;
}) {
  const poster = useFeatureVideoStore(
    (state) => state.feed?.items.find((item) => item.id === videoId)?.poster,
  );
  const [failed, setFailed] = useState<string | null>(null);
  if (!poster || failed === poster) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onOpen();
        useFeatureVideoStore.getState().open(videoId, true);
      }}
      aria-label={`Video ansehen: ${title}`}
      className="flex w-full cursor-pointer items-center gap-3 bg-muted/40 px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:bg-muted/70 focus-visible:outline-none active:bg-muted"
    >
      <img
        src={poster}
        alt=""
        decoding="async"
        className="aspect-video w-24 shrink-0 rounded-md bg-muted object-cover"
        onError={() => setFailed(poster)}
      />
      <span className="flex min-w-0 items-center gap-1.5">
        <Play aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{title}</span>
      </span>
    </button>
  );
}
