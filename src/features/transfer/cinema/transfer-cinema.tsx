import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { IslandElapsed } from "@/features/shell/dynamic-island/island-elapsed";
import type { SavedConnection } from "@/lib/connections";
import type { TransferOutcome, TransferPlan, TransferProgress } from "@/lib/db";
import { EASE_OUT } from "@/lib/ease";
import { TransferCinemaCounter } from "./transfer-cinema-counter";
import { TransferCinemaNode } from "./transfer-cinema-node";
import { TransferCinemaStream } from "./transfer-cinema-stream";

const PHASE_LABELS: Record<TransferProgress["progress"]["phase"], string> = {
  pre: "Struktur wird angelegt",
  data: "Daten fließen",
  post: "Schlüssel und Indizes werden gesetzt",
  finalize: "Sequenzen werden nachgezogen",
};

const PHASE_SHARE: Record<TransferProgress["progress"]["phase"], [number, number]> = {
  pre: [0, 10],
  data: [10, 85],
  post: [85, 97],
  finalize: [97, 100],
};

function percentOf(progress: TransferProgress["progress"] | null): number {
  if (!progress) return 0;
  const [from, to] = PHASE_SHARE[progress.phase];
  const inner = progress.tables > 0 ? progress.tableIndex / progress.tables : 0;
  return from + (to - from) * Math.min(1, inner);
}

export function TransferCinema({
  open,
  source,
  target,
  sourceDatabase,
  targetDatabase,
  plan,
  progress,
  outcome,
  running,
  startedAt,
  onCancel,
  onClose,
}: {
  open: boolean;
  source: SavedConnection | null;
  target: SavedConnection | null;
  sourceDatabase: string | null;
  targetDatabase: string | null;
  plan: TransferPlan | null;
  progress: TransferProgress["progress"] | null;
  outcome: TransferOutcome | null;
  running: boolean;
  startedAt: number;
  onCancel: () => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const state = outcome
    ? outcome.committed
      ? "success"
      : "failure"
    : running
      ? "running"
      : "idle";
  const percent = state === "success" ? 100 : percentOf(progress);
  const tables = progress?.tables ?? plan?.tables.length ?? 0;
  const index = Math.min(tables, (progress?.tableIndex ?? 0) + 1);
  const headline =
    state === "success"
      ? "Übertragen und verifiziert"
      : state === "failure"
        ? "Transfer fehlgeschlagen"
        : progress
          ? PHASE_LABELS[progress.phase]
          : "Verbindung wird aufgebaut";
  const rows = state === "success" ? (outcome?.rows ?? 0) : (progress?.totalRows ?? 0);

  useEffect(() => {
    if (!open || state !== "success") return;
    const timer = window.setTimeout(onClose, 3200);
    return () => window.clearTimeout(timer);
  }, [open, state, onClose]);

  useEffect(() => {
    if (!open || state !== "failure") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, state, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && source && target && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Transfer läuft"
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden bg-[#06090f]/92 text-white backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeInOut" } }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          onClick={state === "success" ? onClose : undefined}
        >
          <div
            aria-hidden
            className="transfer-aurora pointer-events-none absolute inset-0 motion-reduce:animate-none"
            data-state={state}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(6,9,15,0.9)_100%)]"
          />
          <motion.span
            className="absolute top-12 text-[11px] font-semibold uppercase text-white/40"
            initial={reduce ? false : { opacity: 0, letterSpacing: "0.9em" }}
            animate={{ opacity: 1, letterSpacing: "0.45em" }}
            transition={{ duration: 1.1, ease: EASE_OUT }}
          >
            Transfer
          </motion.span>

          <div className="relative flex w-full max-w-4xl items-center justify-center gap-4 px-10">
            <TransferCinemaNode
              connection={source}
              database={sourceDatabase}
              caption="Quelle"
              percent={null}
              state={state === "failure" ? "idle" : state}
              delay={0.1}
            />
            <TransferCinemaStream
              active={state === "running"}
              state={state}
              table={state === "running" ? (progress?.table ?? null) : null}
              tableKey={`${progress?.phase ?? ""}-${progress?.tableIndex ?? 0}`}
            />
            <TransferCinemaNode
              connection={target}
              database={targetDatabase}
              caption="Ziel"
              percent={percent}
              state={state}
              delay={0.25}
            />
          </div>

          <motion.div
            className="mt-14 flex flex-col items-center gap-3"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.6 }}
          >
            <TransferCinemaCounter value={rows} />
            <span className="text-xs uppercase tracking-[0.3em] text-white/40">Zeilen</span>
            <div className="relative mt-2 h-6 w-[32rem] max-w-[90vw]">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={headline}
                  className="absolute inset-x-0 text-center text-base text-white/85"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, filter: "blur(6px)" }}
                  transition={{ duration: 0.45, ease: EASE_OUT }}
                >
                  {headline}
                </motion.span>
              </AnimatePresence>
            </div>
            <span className="h-4 text-xs text-white/45 tabular-nums">
              {state === "running" && tables > 0 && `Tabelle ${index} von ${tables}`}
              {state === "success" && outcome && `${outcome.tables.length} Tabellen`}
              {state === "failure" &&
                outcome &&
                (outcome.rolledBack
                  ? "Das Ziel wurde in den Ausgangszustand zurückgesetzt."
                  : "Das Ziel ist nicht vollständig bereinigt.")}
            </span>
            {state === "failure" && outcome?.error && (
              <pre className="mt-1 max-h-32 max-w-[40rem] overflow-auto rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-red-200">
                {outcome.error}
              </pre>
            )}
          </motion.div>

          <motion.div
            className="absolute bottom-10 flex items-center gap-4"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1 }}
          >
            {state === "running" && (
              <>
                <IslandElapsed since={startedAt} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/60 hover:bg-white/10 hover:text-white"
                  onClick={onCancel}
                >
                  Abbrechen
                </Button>
              </>
            )}
            {state === "failure" && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white"
                onClick={onClose}
              >
                Schließen
              </Button>
            )}
            {state === "success" && (
              <span className="text-xs text-white/40">Klicken zum Schließen</span>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
