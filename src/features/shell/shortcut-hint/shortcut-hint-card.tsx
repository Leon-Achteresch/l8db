import { CheckIcon, KeyboardIcon, XIcon } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SPRING_LAYOUT, SPRING_PANEL, SPRING_PRESS } from "@/lib/ease";
import { commandById, formatHotkeyDisplay, useResolvedHotkey } from "@/lib/hotkeys";
import { type ActiveHint, useShortcutHintsStore } from "@/lib/shortcut-hints";
import { ShortcutHintKeys } from "./shortcut-hint-keys";

const VISIBLE_MS = 9_000;
const VISIBLE_REDUCED_MS = 20_000;
const LEARNED_MS = 1_800;

export function ShortcutHintCard({ hint }: { hint: ActiveHint }) {
  const reduced = useReducedMotion();
  const dismiss = useShortcutHintsStore((state) => state.dismiss);
  const mute = useShortcutHintsStore((state) => state.mute);
  const hotkey = useResolvedHotkey(hint.id);
  const command = commandById(hint.id);
  const label = command?.label ?? hint.id;
  const area = command && command.area !== "Allgemein" ? command.area : null;
  const visibleMs = reduced ? VISIBLE_REDUCED_MS : VISIBLE_MS;
  const progress = useMotionValue(1);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (hint.learned) {
      const timer = window.setTimeout(dismiss, LEARNED_MS);
      return () => window.clearTimeout(timer);
    }
    if (paused) return;
    const controls = animate(progress, 0, {
      duration: (progress.get() * visibleMs) / 1000,
      ease: "linear",
      onComplete: dismiss,
    });
    return () => controls.stop();
  }, [hint.learned, paused, progress, dismiss, visibleMs]);

  return (
    <motion.div
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.92, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.96, filter: "blur(6px)" }}
      transition={{ ...SPRING_PANEL, layout: SPRING_LAYOUT }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto relative flex max-w-full items-center gap-3 overflow-hidden rounded-2xl border border-border/70 bg-popover/95 py-2.5 pr-2 pl-2.5 text-popover-foreground shadow-2xl shadow-black/20 backdrop-blur-xl dark:shadow-black/50"
    >
      {!reduced && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,color-mix(in_oklab,var(--primary)_14%,transparent)_50%,transparent_70%)]"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 1.4, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        {hint.learned ? (
          <motion.div
            key="learned"
            className="flex items-center gap-3"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING_PRESS}
          >
            <motion.span
              className="grid size-8 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              initial={{ scale: 0.4, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 18 }}
            >
              <CheckIcon className="size-4" strokeWidth={3} />
            </motion.span>
            <div className="min-w-0 pr-2">
              <p className="text-sm font-medium">Genau so!</p>
              <p className="text-xs text-muted-foreground">
                Kürzel sitzt. Zu „{label}" kommt kein Tipp mehr.
              </p>
            </div>
            <ShortcutHintKeys hotkey={hotkey} pressed />
          </motion.div>
        ) : (
          <motion.div
            key="hint"
            className="flex items-center gap-3"
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
          >
            <motion.span
              className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary"
              initial={reduced ? false : { scale: 0.5, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ ...SPRING_PRESS, delay: 0.08 }}
            >
              <KeyboardIcon className="size-4" />
            </motion.span>
            <div className="min-w-0 max-w-72">
              <p className="text-xs text-muted-foreground">
                Nächstes Mal schneller per Tastatur{area ? ` · ${area}` : ""}
              </p>
              <p className="line-clamp-2 text-sm font-medium" title={label}>
                {label}
              </p>
              <span className="sr-only">Tastenkürzel: {formatHotkeyDisplay(hotkey)}</span>
            </div>
            <ShortcutHintKeys hotkey={hotkey} />
            <div className="ml-1 flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                aria-label={`Keine Tipps mehr zu „${label}"`}
                onClick={() => mute(hint.id)}
              >
                Nicht mehr zeigen
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Tipp schließen (Esc)"
                title="Schließen (Esc)"
                onClick={dismiss}
              >
                <XIcon />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!hint.learned && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary/70"
          style={{ scaleX: progress }}
        />
      )}
    </motion.div>
  );
}
