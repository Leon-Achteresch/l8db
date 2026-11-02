import { motion, useReducedMotion } from "motion/react";
import { Kbd } from "@/components/ui/kbd";
import { SPRING_PRESS } from "@/lib/ease";
import { splitHotkeyForKbd } from "@/lib/hotkeys";

export function ShortcutHintKeys({ hotkey, pressed }: { hotkey: string; pressed?: boolean }) {
  const reduced = useReducedMotion();
  const keys = splitHotkeyForKbd(hotkey);
  return (
    <span className="flex items-center gap-1 [perspective:400px]" aria-hidden>
      {keys.map((key, index) => (
        <motion.span
          key={key}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10, rotateX: -70 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ ...SPRING_PRESS, delay: 0.18 + index * 0.07 }}
        >
          <motion.span
            className="block"
            animate={
              reduced
                ? undefined
                : pressed
                  ? { y: [0, 2.5, 0], scale: [1, 0.94, 1] }
                  : { y: [0, 0, 2.5, 0] }
            }
            transition={
              pressed
                ? { duration: 0.32, delay: index * 0.05 }
                : {
                    duration: 0.5,
                    times: [0, 0.4, 0.65, 1],
                    delay: 0.9 + index * 0.08,
                    repeat: 1,
                    repeatDelay: 1.6,
                  }
            }
          >
            <Kbd className="h-auto min-h-6 min-w-6 rounded-md border border-b-2 border-border bg-background px-1.5 font-mono text-xs text-foreground shadow-sm">
              {key}
            </Kbd>
          </motion.span>
        </motion.span>
      ))}
    </span>
  );
}
