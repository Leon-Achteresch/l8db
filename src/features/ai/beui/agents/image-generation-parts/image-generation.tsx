import { RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT, SPRING_PRESS } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import { DitherField } from "./dither-field";
import { DitherMark } from "./dither-mark";
import { type ImageGenerationProps, MEDIA_STATE, STATUS_TEXT } from "./shared";

export function ImageGeneration({
  children,
  status = "generating",
  label,
  prompt,
  resolution = "1024 × 1024",
  aspectRatio = "1 / 1",
  size = "compact",
  interactive = true,
  statusText,
  showStatus = true,
  onRetry,
  className,
  mediaClassName,
  statusClassName,
}: ImageGenerationProps) {
  const reduce = useReducedMotion() ?? false;
  const active = status === "queued" || status === "generating" || status === "refining";
  const mediaState = MEDIA_STATE[status];
  const resolvedStatusText = statusText ?? STATUS_TEXT[status];
  const resolvedLabel = label ?? (prompt ? `${resolvedStatusText}: ${prompt}` : resolvedStatusText);
  return (
    <div
      data-slot="image-generation"
      data-state={status}
      aria-busy={active}
      className={cn("w-full", className)}
    >
      <div className={cn("w-full", size === "compact" && "mx-auto max-w-52")}>
        <div
          role="img"
          aria-label={resolvedLabel}
          style={{ aspectRatio }}
          className="relative isolate w-full overflow-hidden rounded-xl bg-muted"
        >
          <motion.div
            aria-hidden={children ? undefined : true}
            initial={false}
            animate={
              reduce
                ? { opacity: mediaState.opacity }
                : {
                    filter: mediaState.filter,
                    opacity: mediaState.opacity,
                    scale: mediaState.scale,
                  }
            }
            transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT }}
            className={cn(
              "absolute inset-0 [&>*]:size-full [&>*]:object-cover [&_img]:size-full [&_img]:object-cover",
              mediaClassName,
            )}
          >
            {children}
          </motion.div>

          <AnimatePresence initial={false}>
            {active ? (
              <motion.div
                key="dither-field"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease: EASE_OUT }}
                className="absolute inset-0"
              >
                <DitherField interactive={interactive} reduce={reduce} status={status} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {resolution ? (
            <span className="absolute top-2 right-2 z-10 rounded-full bg-background/75 px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {resolution}
            </span>
          ) : null}
        </div>

        {showStatus || prompt ? (
          <div className="mt-3 text-left">
            {showStatus ? (
              <div
                aria-live="polite"
                className={cn(
                  "flex min-h-5 items-center gap-2 text-sm font-medium text-foreground",
                  status === "error" && "text-destructive",
                  statusClassName,
                )}
              >
                <DitherMark status={status} reduce={reduce} />
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={resolvedStatusText}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -4 }}
                    transition={{
                      duration: reduce ? 0 : 0.15,
                      ease: EASE_OUT,
                    }}
                  >
                    {resolvedStatusText}
                  </motion.span>
                </AnimatePresence>
              </div>
            ) : null}
            {prompt ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">“{prompt}”</p>
            ) : null}
          </div>
        ) : null}

        {status === "error" && onRetry ? (
          <motion.button
            type="button"
            onClick={onRetry}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            transition={SPRING_PRESS}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            Try again
          </motion.button>
        ) : null}
      </div>
    </div>
  );
}
