import { ArrowUpRight, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type BlogPost, DISPLAY_MS } from "@/lib/blog-suggestions/model";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props {
  post: BlogPost;
  suspended: boolean;
  onDismiss: () => void;
  onRead: () => void;
  onExpire?: () => void;
}

const dateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function BlogSuggestionCard({ post, suspended, onDismiss, onRead, onExpire }: Props) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const remaining = useRef(DISPLAY_MS);
  const image = post.image && !imageFailed ? post.image : null;
  const paused = suspended || hovered || focused;

  useEffect(() => {
    if (paused || !onExpire) return;
    const started = Date.now();
    const timer = window.setTimeout(onExpire, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onExpire]);

  const close = (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onDismiss}
      aria-label="Blog-Vorschlag schließen"
      className={cn(
        "size-8 rounded-full",
        image
          ? "absolute top-3 right-3 z-10 bg-foreground/75 text-background shadow-sm backdrop-blur-sm hover:bg-foreground/90 focus-visible:ring-ring dark:bg-background/75 dark:text-foreground dark:hover:bg-background/90"
          : "-my-1.5 -mr-1.5 ml-auto text-muted-foreground hover:text-foreground",
      )}
    >
      <X className="size-4" />
    </Button>
  );

  return (
    <motion.aside
      data-blog-suggestion
      aria-labelledby={titleId}
      aria-hidden={suspended}
      inert={suspended}
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: suspended ? 0 : 1, y: 0, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        }
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className="fixed right-4 bottom-11 z-40 overflow-hidden rounded-[24px] border border-border/70 bg-card text-card-foreground shadow-xl shadow-foreground/10"
      style={{
        width: "min(380px, calc(100vw - 32px))",
        visibility: suspended ? "hidden" : "visible",
      }}
    >
      {image ? (
        <div className="relative aspect-[1200/630] bg-muted">
          <img
            src={image}
            alt={post.imageAlt ?? ""}
            className="h-full w-full object-cover"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
          {close}
        </div>
      ) : null}
      <div className="px-4 pt-4 pb-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          <span>Aus dem Blog</span>
          <span aria-hidden="true">·</span>
          <span>{post.readingMinutes} Min. Lesezeit</span>
          {image ? null : close}
        </div>
        <h2
          id={titleId}
          className="line-clamp-2 break-words text-[15px] font-semibold leading-snug tracking-tight"
        >
          {post.title}
        </h2>
        <p className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">
          {post.summary}
        </p>
        <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3">
          <time
            dateTime={post.publishedAt}
            className="text-[11px] tabular-nums text-muted-foreground"
          >
            {dateFormat.format(new Date(`${post.publishedAt}T00:00:00Z`))}
          </time>
          <div className="flex-1" />
          <Button size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={onRead}>
            Lesen
            <span className="sr-only"> im Browser</span>
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </motion.aside>
  );
}
