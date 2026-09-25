import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOUR_CHAPTERS } from "@/lib/tour/chapters";
import { useTourStore } from "@/lib/tour/store";

export function TourOffer() {
  const start = useTourStore((s) => s.startFromBeginning);
  const dismiss = useTourStore((s) => s.dismissOffer);

  return (
    <aside
      data-tour-ui="offer"
      className="pointer-events-auto fixed right-4 bottom-4 z-[10000001] flex w-[19rem] flex-col gap-2 rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-2xl shadow-black/20 backdrop-blur-xl"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Neu hier? Produkttour</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Wir zeigen dir Schritt für Schritt, wie alles funktioniert — in {TOUR_CHAPTERS.length}{" "}
            kurzen Kapiteln. Du musst nichts wissen. Klicke einfach auf „Tour starten“.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dismiss()}
          aria-label="Tour-Angebot schließen"
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 flex-1"
          onClick={() => dismiss()}
        >
          Später
        </Button>
        <Button type="button" size="sm" className="h-8 flex-1" onClick={() => start()}>
          Tour starten
        </Button>
      </div>
    </aside>
  );
}
