import { motion } from "motion/react";
import { useEffect } from "react";
import { EASE_OUT } from "@/lib/ease";

const CURTAIN = [0.65, 0, 0.35, 1] as const;
const INTRO_MS = 5400;
const WORDMARK = ["l", "8", "d", "b"];
const PARTICLES = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: (i * 61 + 7) % 100,
  size: 1 + (i % 3),
  delay: 0.6 + (i % 13) * 0.22,
  duration: 3.5 + (i % 5) * 0.7,
}));

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
      className="absolute inset-0 z-10 cursor-pointer overflow-hidden bg-black text-white select-none"
      onClick={onComplete}
      exit={{ opacity: 0, scale: 1.4, filter: "blur(24px)" }}
      transition={{ duration: 0.9, ease: [0.7, 0, 0.84, 0] }}
    >
      <div className="absolute inset-x-0 bottom-0 h-1/2 [perspective:520px]">
        <motion.div
          className="absolute -inset-x-1/2 inset-y-0 origin-bottom [transform:rotateX(74deg)] bg-[linear-gradient(to_right,rgb(56_189_248/0.28)_1px,transparent_1px),linear-gradient(to_bottom,rgb(56_189_248/0.28)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_top,black_10%,transparent_85%)]"
          initial={{ opacity: 0, backgroundPositionY: "0px" }}
          animate={{ opacity: 1, backgroundPositionY: "560px" }}
          transition={{
            opacity: { duration: 2.2, delay: 0.6 },
            backgroundPositionY: { duration: 5, ease: "linear", repeat: Number.POSITIVE_INFINITY },
          }}
        />
      </div>

      <motion.div
        className="absolute inset-0 m-auto size-[80vmax] rounded-full bg-[radial-gradient(circle,rgb(99_102_241/0.5),rgb(14_165_233/0.16)_32%,transparent_62%)]"
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{ opacity: [0, 1, 0.75], scale: [0.3, 1.15, 1] }}
        transition={{ duration: 3.4, delay: 1, ease: EASE_OUT }}
      />

      {PARTICLES.map((p) => (
        <motion.span
          key={`${p.left}-${p.top}`}
          className="absolute rounded-full bg-sky-200"
          style={{ left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size }}
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: [0, 0.9, 0], y: -60 }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: "easeOut",
            repeat: Number.POSITIVE_INFINITY,
          }}
        />
      ))}

      <motion.div
        className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-white to-transparent"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: [0, 1, 1], opacity: [0, 1, 0] }}
        transition={{ duration: 2.2, delay: 0.7, times: [0, 0.45, 1], ease: EASE_OUT }}
      />
      <motion.div
        className="absolute inset-x-0 top-1/2 h-28 -mt-14 bg-sky-400/40 blur-3xl"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: [0, 1.2, 1], opacity: [0, 0.9, 0] }}
        transition={{ duration: 2.6, delay: 0.8, times: [0, 0.4, 1], ease: EASE_OUT }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-7">
        <motion.img
          src="/logo.png"
          alt=""
          draggable={false}
          className="size-28 rounded-[22%] shadow-[0_0_90px_rgb(99_102_241/0.65)]"
          initial={{ opacity: 0, scale: 1.9, filter: "blur(28px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 1.7, delay: 1.4, ease: EASE_OUT }}
        />
        <h1 className="flex font-mono text-7xl font-semibold tracking-tight">
          {WORDMARK.map((char, i) => (
            <motion.span
              key={char}
              initial={{ opacity: 0, y: 48, filter: "blur(14px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 1, delay: 2.3 + i * 0.1, ease: EASE_OUT }}
            >
              {char}
            </motion.span>
          ))}
        </h1>
        <motion.p
          className="text-xs font-medium uppercase text-white/60"
          initial={{ opacity: 0, letterSpacing: "1.4em" }}
          animate={{ opacity: 1, letterSpacing: "0.5em" }}
          transition={{ duration: 2, delay: 3.1, ease: EASE_OUT }}
        >
          Alle Datenbanken. Ein Client.
        </motion.p>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,black_100%)]" />

      <motion.div
        className="absolute inset-x-0 top-0 z-10 bg-black"
        initial={{ height: "50%" }}
        animate={{ height: "11%" }}
        transition={{ duration: 1.5, delay: 0.25, ease: CURTAIN }}
      />
      <motion.div
        className="absolute inset-x-0 bottom-0 z-10 bg-black"
        initial={{ height: "50%" }}
        animate={{ height: "11%" }}
        transition={{ duration: 1.5, delay: 0.25, ease: CURTAIN }}
      />

      <motion.button
        type="button"
        onClick={onComplete}
        className="absolute right-6 bottom-5 z-20 text-[10px] uppercase tracking-[0.35em] text-white/40 transition-colors hover:text-white"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.8 }}
      >
        Überspringen
      </motion.button>
    </motion.div>
  );
}
