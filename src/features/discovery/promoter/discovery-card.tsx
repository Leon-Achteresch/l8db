import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { EASE_OUT } from "@/lib/ease";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { NewFeatureId } from "@/lib/new-features";

interface Props {
  label: string;
  title: string;
  summary?: string;
  featureId: NewFeatureId;
  onClose: () => void;
  autoCloseMs?: number;
  children?: ReactNode;
}

export function DiscoveryCard({
  label,
  title,
  summary,
  featureId,
  onClose,
  autoCloseMs,
  children,
}: Props) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const { ref, isNew } = useNewFeatureVisibility<HTMLElement>(featureId);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(autoCloseMs ?? 0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const paused = hovered || focused;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!autoCloseMs || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => closeRef.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [autoCloseMs, paused]);

  return (
    <motion.aside
      ref={ref}
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className="fixed right-4 bottom-11 z-40 rounded-2xl bg-popover/95 px-4 pt-3.5 pb-3 text-popover-foreground shadow-xl shadow-foreground/10 backdrop-blur-xl"
      style={{ width: "min(340px, calc(100vw - 32px))" }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="truncate">{label}</span>
        {isNew ? <NewBadge /> : null}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Schließen (Esc)"
          title="Schließen (Esc)"
          className="-my-1.5 -mr-2 ml-auto size-7 rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <h2 id={titleId} className="line-clamp-2 text-sm font-semibold leading-snug">
        {title}
      </h2>
      {summary ? (
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {summary}
        </p>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </motion.aside>
  );
}
