import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EASE_OUT } from "@/lib/ease";

const NOTE_DISPLAY_MS = 30_000;

export interface NoteAction {
  label: string;
  onClick: () => void;
}

interface Props {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body?: string;
  actions: NoteAction[];
  onClose: () => void;
}

export function DiscoveryNoteCard({ icon: Icon, eyebrow, title, body, actions, onClose }: Props) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(NOTE_DISPLAY_MS);

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(onClose, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onClose]);

  return (
    <motion.aside
      aria-labelledby={titleId}
      data-discovery-note
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.2, ease: EASE_OUT }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      className="fixed right-4 bottom-11 z-40 rounded-2xl bg-popover p-4 text-popover-foreground shadow-xl shadow-foreground/10"
      style={{ width: "min(340px, calc(100vw - 32px))" }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted/60 text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground">{eyebrow}</p>
          <h2 id={titleId} className="text-sm font-semibold leading-snug">
            {title}
          </h2>
          {body && (
            <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-muted-foreground">
              {body}
            </p>
          )}
          {actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((action, index) => (
                <Button
                  key={action.label}
                  size="sm"
                  variant={index === 0 ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Schließen"
          className="-mt-1 -mr-1 size-7 rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      </div>
    </motion.aside>
  );
}
