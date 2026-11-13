import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TourMascot } from "@/features/tour/tour-mascot";
import { TOUR_MASCOT_NAME } from "@/lib/tour/ask";
import { TOUR_CHAPTERS } from "@/lib/tour/chapters";
import { useTourStore } from "@/lib/tour/store";

const ENTER = { type: "spring", stiffness: 70, damping: 16, mass: 1 } as const;

export function TourOffer() {
  const reduce = useReducedMotion();
  const [walkedIn, setWalkedIn] = useState(false);
  const arrived = walkedIn || Boolean(reduce);
  const start = useTourStore((s) => s.startFromBeginning);
  const dismiss = useTourStore((s) => s.dismissOffer);

  return (
    <aside
      data-tour-ui="offer"
      aria-label={`${TOUR_MASCOT_NAME} bietet eine Tour an`}
      className="pointer-events-none fixed right-4 bottom-10 z-[10000001] flex items-end gap-2"
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.94, x: 12 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        transition={
          reduce ? { duration: 0 } : { delay: 0.55, type: "spring", stiffness: 180, damping: 22 }
        }
        style={{ transformOrigin: "100% 70%" }}
        className="pointer-events-auto relative mb-6 w-[18.5rem] rounded-2xl bg-card/95 p-4 text-card-foreground shadow-2xl ring-1 shadow-black/25 ring-border/60 backdrop-blur-xl"
      >
        <span
          aria-hidden
          className="absolute -right-[5px] bottom-7 size-3 rotate-45 rounded-[2px] bg-card"
        />
        <button
          type="button"
          onClick={() => dismiss()}
          aria-label="Tour-Angebot schließen"
          className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {TOUR_CHAPTERS.length} Kapitel
        </p>
        <p className="mt-1.5 pr-6 text-[15px] font-semibold tracking-tight">
          Hi, ich bin {TOUR_MASCOT_NAME}.
        </p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Soll ich dir l8db zeigen? Ich laufe vor und erkläre alles Schritt für Schritt.
        </p>
        <div className="mt-3.5 flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 flex-1 rounded-full"
            onClick={() => dismiss()}
          >
            Später
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 flex-1 rounded-full"
            onClick={() => start()}
          >
            Tour starten
          </Button>
        </div>
      </motion.div>
      <motion.div
        aria-hidden
        className="drop-shadow-[0_10px_18px_rgba(0,0,0,0.28)]"
        initial={reduce ? false : { x: 140 }}
        animate={{ x: 0 }}
        transition={reduce ? { duration: 0 } : ENTER}
        onAnimationComplete={() => setWalkedIn(true)}
      >
        <TourMascot
          mood={arrived ? "waving" : "idle"}
          walking={!arrived}
          look={{ x: -0.6, y: -0.3 }}
        />
      </motion.div>
    </aside>
  );
}
