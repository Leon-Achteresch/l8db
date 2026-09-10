import { LifeBuoy } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DiagnosticsDialog } from "@/features/about/diagnostics-dialog";
import { SPRING_LAYOUT } from "@/lib/ease";

export function AboutDiagnostics() {
  const [open, setOpen] = useState(false);

  return (
    <motion.section
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="rounded-3xl border bg-card px-6 py-6 sm:px-8"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <LifeBuoy className="size-4" />
            Diagnosepaket
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            App-Version, Plattform, Treiberstatus, Anbieter und bereinigte Einstellungen als lokale
            JSON-Datei. Vor dem Speichern vollständig einsehbar, ohne Geheimnisse und ohne
            SQL-Verlauf.
          </p>
        </div>
        <Button variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
          Diagnosepaket erstellen
        </Button>
      </div>
      <DiagnosticsDialog open={open} onOpenChange={setOpen} />
    </motion.section>
  );
}
