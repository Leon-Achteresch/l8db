import { motion, useReducedMotion, useScroll } from "motion/react";
import { useRef } from "react";
import { AboutDiagnostics } from "@/features/about/about-diagnostics";
import { AboutFeatures } from "@/features/about/about-features";
import { AboutFooter } from "@/features/about/about-footer";
import { AboutHero } from "@/features/about/about-hero";
import { AboutNav } from "@/features/about/about-nav";
import { AboutStack } from "@/features/about/about-stack";
import { AboutWorkflow } from "@/features/about/about-workflow";

export function AboutView() {
  const scrollRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ container: scrollRef });

  return (
    <main
      ref={scrollRef}
      className="about-shell relative h-full w-full min-w-0 overflow-y-auto scroll-smooth"
      data-tour="about-page"
    >
      <motion.div
        aria-hidden
        className="about-progress fixed inset-x-0 top-0 z-30 h-0.5 origin-left"
        style={reduce ? undefined : { scaleX: scrollYProgress }}
      />
      <div aria-hidden className="about-noise pointer-events-none fixed inset-0 z-0" />
      <AboutNav />
      <div className="relative z-10">
        <AboutHero scrollYProgress={scrollYProgress} />
        <AboutStack />
        <AboutFeatures />
        <AboutWorkflow />
        <AboutDiagnostics />
        <AboutFooter />
      </div>
    </main>
  );
}
