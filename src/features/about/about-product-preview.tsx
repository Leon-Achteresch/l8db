import {
  Braces,
  ChevronDown,
  Database,
  Eye,
  ListFilter,
  Maximize2,
  Play,
  Rows3,
} from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { type PointerEvent as ReactPointerEvent, useState } from "react";
import { AppLogo } from "@/components/app-logo";
import { ActionSwapButton } from "@/components/motion/action-swap";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { SwitchButton } from "@/components/motion/switch-button";
import { Tooltip } from "@/components/motion/tooltip";
import { cn } from "@/lib/utils";

const PREVIEW_ROWS = [
  ["01", "Ada Lovelace", "ada@analytical.engine", "active"],
  ["02", "Alan Turing", "alan@bombe.uk", "active"],
  ["03", "Grace Hopper", "grace@compiler.io", "paused"],
  ["04", "Edsger Dijkstra", "edsger@structured.eu", "active"],
];

export function AboutProductPreview() {
  const reduce = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useTransform(pointerY, [-0.5, 0.5], [5, -5]);
  const rotateY = useTransform(pointerX, [-0.5, 0.5], [-6, 6]);
  const [readOnly, setReadOnly] = useState(true);

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function resetTilt() {
    if (reduce) return;
    animate(pointerX, 0, { duration: 0.45, ease: [0.22, 1, 0.36, 1] });
    animate(pointerY, 0, { duration: 0.45, ease: [0.22, 1, 0.36, 1] });
  }

  return (
    <div
      className="about-preview-stage"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
    >
      <motion.div
        className="about-product-preview"
        style={reduce ? undefined : { rotateX, rotateY, transformPerspective: 1300 }}
        animate={reduce ? undefined : { y: [0, -8, 0] }}
        transition={
          reduce ? undefined : { duration: 7, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }
        }
      >
        <div className="about-product-topbar">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-6 place-items-center rounded-lg bg-white/10">
              <AppLogo alt="" className="size-4" />
            </span>
            <span className="truncate text-[11px] font-medium text-white/80">l8db / analytics</span>
            <ChevronDown className="size-3 text-white/35" />
          </div>
          <div className="flex items-center gap-2">
            <AnimatedBadge
              status="success"
              size="sm"
              className="border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
            >
              Connected
            </AnimatedBadge>
            <Tooltip content="Vollbild öffnen" side="top">
              <button
                type="button"
                aria-label="Vollbild öffnen"
                className="grid size-6 place-items-center rounded-md text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Maximize2 className="size-3" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="grid min-h-[22rem] grid-cols-[9rem_1fr] bg-[#11151d] sm:min-h-[25rem] sm:grid-cols-[11rem_1fr]">
          <aside className="border-r border-white/[0.07] bg-[#0e1219] p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/35">
                Schema
              </span>
              <Database className="size-3 text-white/30" />
            </div>
            <div className="space-y-1 font-mono text-[10px]">
              {[
                ["public", true],
                ["customers", false],
                ["orders", false],
                ["events", false],
              ].map(([label, active]) => (
                <div
                  key={label as string}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5",
                    active ? "bg-cyan-300/10 text-cyan-200" : "text-white/38",
                  )}
                >
                  <span
                    className={cn("size-1 rounded-full", active ? "bg-cyan-300" : "bg-white/20")}
                  />
                  <span>{label as string}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-white/[0.07] pt-4">
              <div className="flex items-center gap-2 px-1 text-[9px] uppercase tracking-[0.15em] text-white/30">
                <span>Saved queries</span>
                <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] text-white/40">
                  4
                </span>
              </div>
              <div className="mt-2 space-y-2 px-1 font-mono text-[10px] text-white/38">
                <p className="truncate text-cyan-200/75">retention_30d.sql</p>
                <p className="truncate">active_users.sql</p>
                <p className="truncate">revenue_by_day.sql</p>
              </div>
            </div>
          </aside>

          <div className="min-w-0 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-cyan-300/10 text-cyan-200">
                  <Rows3 className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px] text-white/85">public.customers</p>
                  <p className="text-[9px] text-white/35">4 rows in 12 ms</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[9px] text-white/40">
                  Read only
                  <SwitchButton
                    checked={readOnly}
                    onCheckedChange={setReadOnly}
                    aria-label="Read only umschalten"
                    className="scale-75"
                  />
                </label>
                <ActionSwapButton
                  items={[
                    { id: "rows", label: "Rows", icon: <Rows3 className="size-3.5" /> },
                    { id: "filter", label: "Filter", icon: <ListFilter className="size-3.5" /> },
                    { id: "json", label: "JSON", icon: <Braces className="size-3.5" /> },
                  ]}
                  variant="outline"
                  size="sm"
                  animation="roll"
                  className="h-7 border-white/10 bg-white/[0.04] text-[10px] text-white/60 hover:bg-white/[0.08] hover:text-white"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c1016]">
              <div className="grid grid-cols-[2rem_1.1fr_1.4fr_3.5rem] gap-2 border-b border-white/[0.07] px-3 py-2 font-mono text-[8px] uppercase tracking-[0.12em] text-white/30 sm:grid-cols-[2rem_1.1fr_1.5fr_4.5rem]">
                <span>#</span>
                <span>name</span>
                <span>email</span>
                <span>state</span>
              </div>
              {PREVIEW_ROWS.map(([id, name, email, state], index) => (
                <motion.div
                  key={id}
                  initial={{ opacity: 0, x: reduce ? 0 : 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 + index * 0.08, duration: 0.45 }}
                  className="grid grid-cols-[2rem_1.1fr_1.4fr_3.5rem] gap-2 border-b border-white/[0.05] px-3 py-2 font-mono text-[9px] last:border-0 sm:grid-cols-[2rem_1.1fr_1.5fr_4.5rem] sm:text-[10px]"
                >
                  <span className="text-white/25">{id}</span>
                  <span className="truncate text-white/78">{name}</span>
                  <span className="truncate text-white/40">{email}</span>
                  <span className={state === "active" ? "text-emerald-300" : "text-amber-200"}>
                    {state}
                  </span>
                </motion.div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2">
              <div className="flex items-center gap-2 font-mono text-[9px] text-white/35">
                <Play className="size-3 text-cyan-300" />
                <span>select * from customers</span>
              </div>
              <Tooltip content="Query ausführen" side="top">
                <button
                  type="button"
                  aria-label="Query ausführen"
                  className="grid size-6 place-items-center rounded-md bg-cyan-300/10 text-cyan-200 transition-colors hover:bg-cyan-300/20"
                >
                  <Play className="size-3 fill-current" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.07] bg-[#0e1219] px-3 py-2 font-mono text-[8px] text-white/30 sm:px-4">
          <span>postgresql://analytics</span>
          <span className="flex items-center gap-2">
            <Eye className="size-3" /> local session
          </span>
        </div>
      </motion.div>
      <div aria-hidden className="about-preview-shadow" />
    </div>
  );
}
