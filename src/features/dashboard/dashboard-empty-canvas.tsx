import { ArrowRightIcon, LibraryIcon, MousePointer2Icon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartKindPreview } from "./chart-kind-preview";

export function DashboardEmptyCanvas({
  onAdd,
  onOpenCharts,
}: {
  onAdd?: () => void;
  onOpenCharts?: () => void;
}) {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-14 text-center sm:py-20">
      <div
        className="mb-7 grid w-full max-w-md grid-cols-[1fr_1.4fr_1fr] items-end gap-3"
        aria-hidden="true"
      >
        <div className="rounded-xl border border-border/70 bg-card p-3">
          <ChartKindPreview kind="column" className="h-16 w-full text-muted-foreground/60" />
        </div>
        <div className="rounded-xl border border-primary/20 bg-card px-4 py-5">
          <ChartKindPreview kind="line" className="h-24 w-full text-primary" />
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-3">
          <ChartKindPreview kind="donut" className="h-16 w-full text-muted-foreground/60" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Illustrationen · hier erscheinen deine Daten
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">
        Dein erster Blick auf die Daten.
      </h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        Starte mit einer Frage. Wähle eine Tabelle, füge Kennzahlen hinzu und sieh sofort, was deine
        Daten zeigen.
      </p>
      {onAdd ? (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={onAdd}>
            <PlusIcon /> Ersten Chart erstellen
          </Button>
          {onOpenCharts && (
            <Button variant="outline" onClick={onOpenCharts}>
              <LibraryIcon /> Aus Sammlung laden
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-5 text-xs text-muted-foreground">
          Wähle „Bearbeiten“, um Charts hinzuzufügen.
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
        <MousePointer2Icon className="size-3.5" />
        <span>Felder ziehen oder anklicken</span>
        <ArrowRightIcon className="size-3" />
        <span>Vorschau prüfen</span>
        <ArrowRightIcon className="size-3" />
        <span>Im Dashboard anordnen</span>
      </div>
    </section>
  );
}
