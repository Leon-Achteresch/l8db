import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { LAB_TABLES } from "./atlas-lab-data";
import { AtlasLabDust } from "./atlas-lab-dust";
import { AtlasLabIslands } from "./atlas-lab-islands";
import { AtlasLabPane } from "./atlas-lab-pane";
import { AtlasLabSpectrum } from "./atlas-lab-spectrum";

const COUNTS = [40, 180, 517];

const variants = [
  {
    title: "01 · Glasscheibe",
    description:
      "Eine durchgehende Fläche statt einzelner Karten. Nur Haarfugen trennen die Tabellen, der Verlauf läuft über alles. Kleine Tabellen bleiben stumm, der Name erscheint unten beim Hover.",
    view: AtlasLabPane,
  },
  {
    title: "02 · Präfix-Inseln",
    description:
      "Tabellen werden nach Namenspräfix gebündelt (ARTIKEL, AUFTRAG, LAGER …). Jede Insel ist eine Glasfläche mit Anzahl und Größe; in ihr steht nur noch der Rest des Namens.",
    view: AtlasLabIslands,
  },
  {
    title: "03 · Fokus und Staub",
    description:
      "Die 14 größten Tabellen bekommen echte Glaskacheln mit Platz für Namen. Der Rest wird zu einem Punktfeld, die Punktgröße zeigt die Größe.",
    view: AtlasLabDust,
  },
  {
    title: "04 · Spektrum",
    description:
      "Keine Karte, sondern eine dichte Liste in Spalten, gruppiert nach Größenband. Ein Verlaufsbalken hinter dem Namen zeigt die Größe. Skaliert auf jede Anzahl und zeigt alle Namen ganz.",
    view: AtlasLabSpectrum,
  },
];

export function AtlasLab() {
  const [count, setCount] = useState(517);
  const tables = useMemo(() => LAB_TABLES.slice(0, count), [count]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Tabellenkarte mit vielen Tabellen
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vier Richtungen im Glas- und Verlaufsstil, mit weniger Rahmen und Rundungen.
            Beispieldaten nach einem Oracle-Schema mit 517 Tabellen.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted/60 p-1 text-xs">
          {COUNTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={count === value}
              onClick={() => setCount(value)}
              className={cn(
                "h-7 rounded-md px-3 tabular-nums focus-visible:ring-2 focus-visible:ring-ring",
                count === value ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {value} Tabellen
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-10 xl:grid-cols-2">
        {variants.map(({ title, description, view: View }) => (
          <section key={title} className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
            </div>
            <div className="relative h-[520px] overflow-hidden rounded-3xl p-4">
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(70%_60%_at_15%_10%,color-mix(in_oklch,var(--chart-1)_22%,transparent),transparent),radial-gradient(60%_60%_at_90%_90%,color-mix(in_oklch,var(--chart-3)_18%,transparent),transparent)]"
              />
              <div className="relative h-full">
                <View tables={tables} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
