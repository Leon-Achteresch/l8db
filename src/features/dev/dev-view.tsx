import { useRef, useState } from "react";
import { animatePageWave, PageWave } from "@/features/table/page-wave";
import { cn } from "@/lib/utils";
import { TabPreview } from "./tab-preview";

const variants = [
  {
    variant: "flat",
    title: "Kompakt & verspielt",
    description:
      "Weiche Tab-Pillen, mintfarbene Icons und ein sanft schwebender aktiver Tab. Kompakt mit etwas Leichtigkeit.",
    height: "36 px",
  },
  {
    variant: "dense",
    title: "Schmale Tabs",
    description:
      "Mehr Tabellen auf derselben Breite. Begrenzte Tab-Breite, volle Namen bei Hover und weitere Aktionen im Menü.",
    height: "32 px",
  },
  {
    variant: "minimal",
    title: "Tab-Auswahl",
    description:
      "Nur die aktuelle Tabelle bleibt sichtbar. Alle offenen Tabellen sind über das Dropdown erreichbar.",
    height: "32 px",
  },
] as const;

export function DevView() {
  const [narrow, setNarrow] = useState(false);
  const [many, setMany] = useState(false);
  const [revision, setRevision] = useState(0);
  const waveRefs = {
    down: useRef<SVGSVGElement>(null),
    up: useRef<SVGSVGElement>(null),
  };

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background px-6 py-8 md:px-10">
      <div className="mx-auto max-w-[1440px] space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-widest text-muted-foreground">
              DEV / DESIGN LAB
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Weniger Leiste. Mehr Tabelle.</h1>
            <p className="text-sm text-muted-foreground">
              Drei interaktive Entwürfe im direkten Vergleich. Alle Daten sind Beispieldaten.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              aria-pressed={narrow}
              onClick={() => setNarrow(!narrow)}
              className={cn(
                "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                narrow && "bg-muted",
              )}
            >
              Schmale Vorschau
            </button>
            <button
              type="button"
              aria-pressed={many}
              onClick={() => setMany(!many)}
              className={cn(
                "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                many && "bg-muted",
              )}
            >
              Viele Tabs
            </button>
            <button
              type="button"
              onClick={() => setRevision(revision + 1)}
              className="h-8 rounded-md px-3 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Zurücksetzen
            </button>
          </div>
        </div>
        <section aria-labelledby="heading-page-wave" className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-muted-foreground">00</span>
            <h2 id="heading-page-wave" className="text-sm font-semibold">
              Seitenwechsel-Whoosh
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Welle am Tabellenrand beim Blättern: unten für die nächste Seite, oben für die
            vorherige.
          </p>
          <div className="flex flex-wrap gap-6">
            {(["down", "up"] as const).map((direction) => (
              <div key={direction} className="space-y-2">
                <div className="flex h-24 w-[320px] items-center justify-center rounded-md border bg-muted/30">
                  <PageWave direction={direction} ref={waveRefs[direction]} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const element = waveRefs[direction].current;
                    if (element) animatePageWave(element);
                  }}
                  className="h-8 rounded-md border px-3 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {direction === "down" ? "Nächste Seite" : "Vorherige Seite"} abspielen
                </button>
              </div>
            ))}
          </div>
        </section>
        {variants.map(({ variant, title, description, height }, index) => (
          <section key={variant} aria-labelledby={`heading-${variant}`} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
              <h2 id={`heading-${variant}`} className="text-sm font-semibold">
                {title}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">{height} Höhe</span>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            <div className={cn("w-full", narrow && "max-w-[520px]")}>
              <TabPreview key={`${variant}-${many}-${revision}`} variant={variant} many={many} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
