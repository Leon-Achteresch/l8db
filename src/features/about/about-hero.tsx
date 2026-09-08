import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Sparkles, Star } from "lucide-react";
import { motion } from "motion/react";
import { AppLogo } from "@/components/app-logo";
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SPRING_LAYOUT } from "@/lib/ease";

export function AboutHero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border bg-card">
      <AnimatedGridPattern
        width={36}
        height={36}
        numSquares={20}
        maxOpacity={0.12}
        duration={3.6}
        className="text-primary [mask-image:radial-gradient(70%_65%_at_50%_35%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/25 blur-3xl dark:bg-primary/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-24 h-56 w-56 rounded-full bg-chart-2/25 blur-3xl"
      />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-6 pb-12 pt-12 text-center sm:pb-16 sm:pt-16">
        <motion.div
          layout
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], layout: SPRING_LAYOUT }}
          className="flex flex-col items-center"
        >
          <span className="grid size-16 place-items-center overflow-hidden rounded-full bg-background shadow-[0_12px_32px_-12px_oklch(0_0_0/0.35)] ring-1 ring-border">
            <AppLogo className="size-11" />
          </span>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="secondary" className="rounded-full px-3">
              <Sparkles className="size-3" data-icon="inline-start" />
              v0.1.0
            </Badge>
            <Badge variant="outline" className="rounded-full px-3 font-normal">
              Tauri v2 · React 19 · Rust
            </Badge>
            <Badge variant="outline" className="rounded-full px-3 font-normal">
              MIT
            </Badge>
          </div>
        </motion.div>
        <motion.h1
          layout
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.55,
            delay: 0.08,
            ease: [0.22, 1, 0.36, 1],
            layout: SPRING_LAYOUT,
          }}
          className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl"
        >
          Datenbanken,
          <br />
          <AnimatedGradientText colorFrom="var(--primary)" colorTo="var(--chart-2)" speed={1.4}>
            wunderschön einfach.
          </AnimatedGradientText>
        </motion.h1>
        <motion.p
          layout
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.55,
            delay: 0.16,
            ease: [0.22, 1, 0.36, 1],
            layout: SPRING_LAYOUT,
          }}
          className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base"
        >
          l8db ist ein schneller, nativer Desktop-Client für PostgreSQL und viele weitere
          Datenbanken — lokal, sicher und tastaturgetrieben. Tabellen durchstöbern, SQL schreiben,
          Schema verstehen.
        </motion.p>
        <motion.div
          layout
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.55,
            delay: 0.24,
            ease: [0.22, 1, 0.36, 1],
            layout: SPRING_LAYOUT,
          }}
          className="mt-7 flex flex-wrap items-center justify-center gap-2.5"
        >
          <Button asChild size="lg" className="rounded-full px-5">
            <Link to="/connections">
              Verbindung öffnen
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-full px-5">
            <a href="https://github.com/Leon-Achteresch/l8db" target="_blank" rel="noreferrer">
              <Star data-icon="inline-start" />
              GitHub
            </a>
          </Button>
        </motion.div>
        <motion.dl
          layout
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.34, layout: SPRING_LAYOUT }}
          className="mt-10 grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border/60 sm:grid-cols-4"
        >
          {[
            ["Nativ", "Tauri v2 Desktop"],
            ["11", "Provider-Familien"],
            ["100 %", "Lokal & offlinefähig"],
            ["0", "Passwörter im Store"],
          ].map(([value, label]) => (
            <div key={label} className="bg-card px-4 py-4">
              <dt className="block text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight">{value}</dd>
            </div>
          ))}
        </motion.dl>
      </div>
    </section>
  );
}
