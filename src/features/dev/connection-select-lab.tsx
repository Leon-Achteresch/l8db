import { useState } from "react";
import { cn } from "@/lib/utils";
import { ConnectionSelectPreview } from "./connection-select-preview";

const variants = [
  {
    variant: "clear",
    title: "01 · Klare Liste",
    description:
      "Aktive Verbindung zuerst, danach Favoriten und weitere Verbindungen. Ruhige Zeilen mit lesbarer Adresse.",
  },
  {
    variant: "server",
    title: "02 · Server zuerst",
    description:
      "Host auswählen, dann die passende Datenbank. Geeignet für viele Verbindungen auf wenigen Servern.",
  },
  {
    variant: "command",
    title: "03 · Schnellwechsel",
    description:
      "Trigger anklicken: Er wächst mit einem weichen Morphing zur Suche und Trefferliste.",
  },
  {
    variant: "cards",
    title: "04 · Detailkarten",
    description:
      "Mehr Platz für Status, Datenbank und Umgebung. Die Auswahl ist deutlich markiert.",
  },
] as const;

export function ConnectionSelectLab() {
  const [narrow, setNarrow] = useState(false);
  const [many, setMany] = useState(false);
  const [revision, setRevision] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Verbindung wechseln</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vier Richtungen für den Select im Sidebar-Header. Suche, Favoriten, Serverwahl und
            Auswahl lassen sich ausprobieren.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            aria-pressed={many}
            onClick={() => setMany(!many)}
            className={cn(
              "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              many && "bg-muted",
            )}
          >
            Viele Gruppen & Verbindungen
          </button>
          <button
            type="button"
            aria-pressed={narrow}
            onClick={() => setNarrow(!narrow)}
            className={cn(
              "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              narrow && "bg-muted",
            )}
          >
            Schmale Sidebar
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
      {many && (
        <p className="text-xs text-muted-foreground">
          Lastfall: 35 Verbindungen auf 14 Servern. Alle Listen sind scrollbar und durchsuchbar.
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        {variants.map(({ variant, title, description }) => (
          <section key={variant} aria-label={title} className="min-w-0 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="max-w-lg text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-sidebar/45 p-4 sm:p-6">
              <div className={cn("mx-auto w-full max-w-[380px]", narrow && "max-w-[296px]")}>
                <ConnectionSelectPreview
                  key={`${variant}-${many}-${revision}`}
                  variant={variant}
                  many={many}
                />
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
