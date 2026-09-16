import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Download, GitBranch, LockKeyhole } from "lucide-react";
import { type MotionValue, motion, useReducedMotion, useTransform } from "motion/react";
import { AboutProductPreview } from "@/features/about/about-product-preview";

const RELEASES_URL = "https://github.com/Leon-Achteresch/l8db/releases/latest";

interface AboutHeroProps {
  scrollYProgress: MotionValue<number>;
}

export function AboutHero({ scrollYProgress }: AboutHeroProps) {
  const reduce = useReducedMotion();
  const previewY = useTransform(scrollYProgress, [0, 0.28], [0, -46]);
  const lightY = useTransform(scrollYProgress, [0, 0.35], [0, 90]);

  return (
    <section
      id="top"
      aria-labelledby="about-title"
      className="relative mx-auto grid min-h-[calc(100dvh-1px)] w-full max-w-[1360px] items-center gap-14 overflow-hidden px-5 pb-16 pt-8 sm:px-8 sm:pt-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-8 lg:px-10 lg:pb-20 lg:pt-6"
    >
      <motion.div
        aria-hidden
        className="about-hero-light pointer-events-none absolute -right-32 top-8 size-[34rem] rounded-full blur-3xl"
        style={reduce ? undefined : { y: lightY }}
      />
      <div className="relative z-10 max-w-[40rem] lg:pb-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="about-kicker"
        >
          <span className="about-kicker-mark" aria-hidden />
          Native database workbench
        </motion.div>
        <motion.h1
          id="about-title"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5 max-w-[10ch] text-balance text-[clamp(3.5rem,7vw,6.7rem)] font-semibold leading-[0.91] tracking-[-0.085em]"
        >
          Datenbanken.
          <span className="about-accent-word mt-2 block pb-2">Ohne Umweg.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.27, ease: [0.22, 1, 0.36, 1] }}
          className="mt-7 max-w-[31rem] text-[15px] leading-7 text-current/58 sm:text-base"
        >
          l8db verbindet, erkundet und verändert Datenbanken mit der Geschwindigkeit eines nativen
          Tools.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.37, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <motion.a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            whileHover={reduce ? undefined : { y: -3, scale: 1.015 }}
            whileTap={reduce ? undefined : { scale: 0.98 }}
            className="about-primary-button inline-flex h-12 items-center gap-2.5 rounded-full px-5 text-sm font-semibold"
          >
            <Download className="size-4" />
            Kostenlos herunterladen
            <ArrowUpRight className="size-4" />
          </motion.a>
          <motion.div
            whileHover={reduce ? undefined : { x: 3 }}
            whileTap={reduce ? undefined : { scale: 0.98 }}
          >
            <Link
              to="/connections"
              className="about-secondary-button inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-medium"
            >
              Arbeitsplatz öffnen
              <ArrowUpRight className="size-4" />
            </Link>
          </motion.div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.56 }}
          className="mt-7 flex items-center gap-4 text-[11px] text-current/43"
        >
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole className="size-3.5" />
            Secrets bleiben lokal
          </span>
          <a
            href="https://github.com/Leon-Achteresch/l8db"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-current"
          >
            <GitBranch className="size-3.5" />
            Open source
          </a>
        </motion.div>
      </div>
      <motion.div
        className="relative z-10 lg:translate-x-4"
        style={reduce ? undefined : { y: previewY }}
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <AboutProductPreview />
      </motion.div>
    </section>
  );
}
