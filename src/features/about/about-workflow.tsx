import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Braces, Check, Maximize2, Network, RefreshCw, Rows3, Table2 } from "lucide-react";
import {
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  CenterMorphModalTrigger,
} from "@/components/motion/center-morph-modal";
import { ActionSwapButton } from "@/components/motion/action-swap";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { SlideActionButton } from "@/components/motion/slide-action-button";
import { SwitchButton } from "@/components/motion/switch-button";
import { cn } from "@/lib/utils";

type WorkflowMode = "browse" | "query" | "map";

const WORKFLOW_OPTIONS = [
  { value: "browse", label: "Browse" },
  { value: "query", label: "Query" },
  { value: "map", label: "Understand" },
] as const;

const WORKFLOW_CONTENT: Record<WorkflowMode, { title: string; copy: string }> = {
  browse: {
    title: "Daten sehen, nicht erraten.",
    copy: "Filtere, sortiere und bearbeite Zeilen direkt dort, wo du sie gefunden hast.",
  },
  query: {
    title: "Vom Gedanken zum Ergebnis.",
    copy: "Schreibe SQL mit Kontext, Verlauf und Resultat in einem ruhigen Arbeitsbereich.",
  },
  map: {
    title: "Das Schema im Zusammenhang.",
    copy: "Verfolge Beziehungen und Abhängigkeiten, bevor sie zum Problem werden.",
  },
};

function WorkflowSurface({ mode, readOnly }: { mode: WorkflowMode; readOnly: boolean }) {
  if (mode === "query") {
    return (
      <div className="about-workflow-query h-full rounded-2xl border border-white/[0.08] bg-[#0b0f15] p-4 font-mono text-[10px] text-white/60 sm:p-6 sm:text-[11px]">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-3 text-[9px] text-white/35">
          <span>active_users.sql</span>
          <span>⌘ Enter</span>
        </div>
        <div className="mt-5 space-y-1.5 leading-6">
          <p><span className="mr-5 text-white/20">01</span><span className="text-cyan-200">with</span> active_users <span className="text-cyan-200">as</span> (</p>
          <p><span className="mr-5 text-white/20">02</span><span className="ml-8 text-cyan-200">select</span> user_id, max(created_at) last_seen</p>
          <p><span className="mr-5 text-white/20">03</span><span className="ml-8 text-cyan-200">from</span> events</p>
          <p><span className="mr-5 text-white/20">04</span><span className="ml-8 text-cyan-200">group by</span> user_id</p>
          <p><span className="mr-5 text-white/20">05</span>)</p>
          <p><span className="mr-5 text-white/20">06</span><span className="text-cyan-200">select</span> * <span className="text-cyan-200">from</span> active_users;</p>
        </div>
        <div className="mt-8 flex items-center gap-2 rounded-xl border border-emerald-300/10 bg-emerald-300/[0.04] px-3 py-2 text-emerald-200/75">
          <Check className="size-3.5" />
          Query ausgeführt in 18 ms
        </div>
      </div>
    );
  }

  if (mode === "map") {
    return (
      <div className="about-workflow-map relative h-full min-h-[18rem] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0f15] p-4 sm:p-6">
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="about-workflow-connection about-workflow-connection-one" />
        <div className="about-workflow-connection about-workflow-connection-two" />
        <div className="about-workflow-map-node about-workflow-map-node-main">
          <Network className="size-4 text-cyan-200" />
          <span>customers</span>
        </div>
        <div className="about-workflow-map-node about-workflow-map-node-top">
          <Rows3 className="size-3.5 text-white/55" />
          <span>orders</span>
        </div>
        <div className="about-workflow-map-node about-workflow-map-node-bottom">
          <Braces className="size-3.5 text-white/55" />
          <span>events</span>
        </div>
        <span className="absolute bottom-4 left-4 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[9px] text-white/35">
          3 tables · 5 relations
        </span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0f15]">
      <div className="grid grid-cols-[2.4rem_1.2fr_1.6fr_5rem] border-b border-white/[0.07] px-4 py-3 font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">
        <span>#</span>
        <span>name</span>
        <span>email</span>
        <span>status</span>
      </div>
      {["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra", "Katherine Johnson"].map((name, index) => (
        <motion.div
          key={name}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.06, duration: 0.32 }}
          className="grid grid-cols-[2.4rem_1.2fr_1.6fr_5rem] border-b border-white/[0.05] px-4 py-3 font-mono text-[10px] last:border-0"
        >
          <span className="text-white/22">0{index + 1}</span>
          <span className="truncate text-white/72">{name}</span>
          <span className="truncate text-white/38">{name.toLowerCase().replaceAll(" ", ".")}@l8db.dev</span>
          <span className={index === 2 ? "text-amber-200" : "text-emerald-200"}>{index === 2 ? "paused" : "active"}</span>
        </motion.div>
      ))}
      <div className="flex items-center justify-between px-4 py-3 text-[9px] text-white/30">
        <span>{readOnly ? "Read only" : "Editable"}</span>
        <span>5 rows</span>
      </div>
    </div>
  );
}

export function AboutWorkflow() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<WorkflowMode>("browse");
  const [readOnly, setReadOnly] = useState(true);
  const [slideComplete, setSlideComplete] = useState(false);
  const content = WORKFLOW_CONTENT[mode];

  return (
    <section id="workflow" className="about-workflow-section border-y border-current/10 bg-current/[0.025]">
      <div className="mx-auto grid w-full max-w-[1360px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.34fr_0.66fr] lg:gap-20 lg:px-10 lg:py-32">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="max-w-[17rem] text-4xl font-semibold tracking-[-0.07em] sm:text-5xl">
            Ein Flow, der mitdenkt.
          </h2>
          <p className="mt-5 max-w-[20rem] text-sm leading-6 text-current/50">
            Wähle, wie du arbeitest. l8db hält den Kontext zusammen.
          </p>
          <div className="mt-8 max-w-[18rem]">
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={WORKFLOW_OPTIONS}
              label="Arbeitsbereich auswählen"
            />
          </div>
          <div className="mt-8 flex items-center gap-3 text-xs text-current/45">
            <SwitchButton checked={readOnly} onCheckedChange={setReadOnly} aria-label="Read only umschalten" />
            <span>Read only Vorschau</span>
          </div>
          <div className="mt-9">
            <SlideActionButton
              completeLabel="Verbindung bereit"
              onComplete={() => setSlideComplete(true)}
              className="w-full max-w-[18rem]"
              fillClassName="bg-cyan-300"
              thumbClassName="bg-cyan-300 text-[#0b0f15]"
            >
              {slideComplete ? "Connection ready" : "Zum Verbinden ziehen"}
            </SlideActionButton>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.h3
                  key={`${mode}-title`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, filter: "blur(4px)" }}
                  transition={{ duration: 0.28 }}
                  className="text-2xl font-semibold tracking-[-0.05em]"
                >
                  {content.title}
                </motion.h3>
              </AnimatePresence>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={`${mode}-copy`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, delay: 0.04 }}
                  className="mt-2 max-w-[30rem] text-sm leading-6 text-current/48"
                >
                  {content.copy}
                </motion.p>
              </AnimatePresence>
            </div>
            <CenterMorphModal>
              <CenterMorphModalTrigger>
                <button type="button" className="about-icon-button" aria-label="Vorschau vergrößern">
                  <Maximize2 className="size-4" />
                </button>
              </CenterMorphModalTrigger>
              <CenterMorphModalContent ariaLabel="l8db Arbeitsbereich Vorschau" className="max-w-4xl bg-[#11151d] p-5 text-white sm:p-7">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">l8db preview</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-[-0.04em]">{content.title}</h3>
                  </div>
                  <CenterMorphModalClose>
                    <button type="button" className="about-icon-button text-white/55" aria-label="Vorschau schließen">
                      <Maximize2 className="size-4 rotate-45" />
                    </button>
                  </CenterMorphModalClose>
                </div>
                <div className="mt-6 min-h-[18rem]">
                  <WorkflowSurface mode={mode} readOnly={readOnly} />
                </div>
              </CenterMorphModalContent>
            </CenterMorphModal>
          </div>

          <div className={cn("about-workflow-panel", mode === "map" && "about-workflow-panel-map")}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-[11px] text-white/45">
                {mode === "browse" ? <Table2 className="size-3.5" /> : mode === "query" ? <Braces className="size-3.5" /> : <Network className="size-3.5" />}
                <span>{mode === "browse" ? "public.customers" : mode === "query" ? "active_users.sql" : "public schema"}</span>
              </div>
              <div className="flex items-center gap-2">
                <AnimatedBadge status="success" size="sm" showIcon={false}>Live preview</AnimatedBadge>
                <ActionSwapButton
                  items={[
                    { id: "run", label: "Run", icon: <Rows3 className="size-3.5" /> },
                    { id: "format", label: "Format", icon: <Braces className="size-3.5" /> },
                    { id: "refresh", label: "Refresh", icon: <RefreshCw className="size-3.5" /> },
                  ]}
                  variant="outline"
                  size="sm"
                  animation="cascade"
                  className="border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white"
                />
              </div>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, filter: "blur(5px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, filter: "blur(5px)" }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="min-h-[18rem]"
              >
                <WorkflowSurface mode={mode} readOnly={readOnly} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
