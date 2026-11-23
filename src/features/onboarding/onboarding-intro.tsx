import { motion } from "motion/react";
import { useEffect } from "react";
import { Illustration } from "@/components/illustration";
import { EASE_OUT } from "@/lib/ease";

const INTRO_MS = 4200;
const WORDMARK = ["l", "8", "d", "b"];
interface OnboardingIntroProps {
  onComplete: () => void;
}

export function OnboardingIntro({ onComplete }: OnboardingIntroProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, INTRO_MS);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onComplete();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onComplete]);

  return (
    <motion.div
      className="absolute inset-0 z-10 cursor-pointer overflow-hidden bg-background text-foreground select-none"
      onClick={onComplete}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.6, ease: EASE_OUT }}
    >
      <motion.div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(ellipse_at_bottom,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_70%)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2.4, delay: 0.2, ease: EASE_OUT }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.6, delay: 0.2, ease: EASE_OUT }}
        >
          <Illustration name="welcome" className="w-72" />
        </motion.div>
        <h1 className="flex font-mono text-6xl font-semibold tracking-tight">
          {WORDMARK.map((char, i) => (
            <motion.span
              key={char}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 1.1 + i * 0.08, ease: EASE_OUT }}
            >
              {char}
            </motion.span>
          ))}
        </h1>
        <motion.p
          className="text-xs font-medium text-muted-foreground uppercase"
          initial={{ opacity: 0, letterSpacing: "0.9em" }}
          animate={{ opacity: 1, letterSpacing: "0.45em" }}
          transition={{ duration: 1.8, delay: 1.6, ease: EASE_OUT }}
        >
          Alle Datenbanken. Ein Client.
        </motion.p>
      </div>

      <motion.button
        type="button"
        onClick={onComplete}
        className="absolute right-6 bottom-5 z-20 cursor-pointer rounded-full px-3 py-1.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.8 }}
      >
        Überspringen
      </motion.button>
    </motion.div>
  );
}
