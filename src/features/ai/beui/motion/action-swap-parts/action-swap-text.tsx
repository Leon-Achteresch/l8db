import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { textCharacters } from "@/features/ai/beui/lib/text-characters";
import { cn } from "@/lib/utils";
import {
  type ActionSwapTextProps,
  CASCADE_LETTER_VARIANTS,
  CASCADE_STAGGER,
  type CoreAnimation,
  TEXT_VARIANTS,
} from "./shared";

export function ActionSwapText({
  value,
  children,
  animation = "blur",
  className,
}: ActionSwapTextProps) {
  const reduce = useReducedMotion();
  const label = typeof children === "string" ? children : null;
  const cascade = animation === "cascade" && label !== null && !reduce;
  const coreAnimation: CoreAnimation = animation === "cascade" ? "roll" : animation;
  return (
    <span
      className={cn(
        "relative -my-[0.08em] inline-block max-w-full whitespace-nowrap py-[0.08em] align-bottom",
        className,
      )}
      style={{
        clipPath: "inset(0 -999px)",
        WebkitClipPath: "inset(0 -999px)",
      }}
    >
      <span aria-hidden className="invisible inline-block whitespace-nowrap">
        {cascade
          ? textCharacters(label).map(({ character: char, id }) => (
              <span key={id} className="inline-block whitespace-pre">
                {char}
              </span>
            ))
          : children}
      </span>
      {cascade ? (
        <>
          <span className="sr-only">{label}</span>
          <AnimatePresence initial={false}>
            <motion.span
              key={`cascade-${value}`}
              aria-hidden
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute left-0 top-[0.08em] inline-block whitespace-pre"
            >
              {textCharacters(label).map(({ character: char, id }, i) => (
                <motion.span
                  key={id}
                  custom={i * CASCADE_STAGGER}
                  variants={CASCADE_LETTER_VARIANTS}
                  className="inline-block whitespace-pre will-change-[opacity,filter,transform]"
                >
                  {char}
                </motion.span>
              ))}
            </motion.span>
          </AnimatePresence>
        </>
      ) : (
        <AnimatePresence initial={false}>
          <motion.span
            key={`${animation}-${value}`}
            variants={TEXT_VARIANTS[coreAnimation]}
            initial={reduce ? false : "initial"}
            animate={reduce ? { opacity: 1, filter: "blur(0px)", scale: 1, y: 0 } : "animate"}
            exit={reduce ? undefined : "exit"}
            className="absolute left-0 top-[0.08em] inline-block max-w-full truncate will-change-[opacity,filter,transform]"
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  );
}
