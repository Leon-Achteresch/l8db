import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type DropTone, ToastDropPreview } from "./toast-drop-preview";
import { GOO_FILTER_ID } from "./toast-drop-variants";

const variants = [
  {
    kind: "capsule",
    title: "01 · Tropfen",
    description:
      "Löst sich unter der Suche, fällt kurz und läuft zur Kapsel auseinander. Einzeilig und am schnellsten.",
  },
  {
    kind: "thread",
    title: "02 · Zäher Faden",
    description:
      "Sinkt langsam an einem Faden und bläht sich zur Karte auf, dann reißt der Faden. Platz für Titel und Beschreibung.",
  },
  {
    kind: "chip",
    title: "03 · Farbtropfen",
    description:
      "Der Tropfen trägt die Statusfarbe und wird zum Icon. Die bisherige Glas-Karte wächst aus ihm heraus.",
  },
  {
    kind: "splash",
    title: "04 · Aufprall",
    description:
      "Fällt bis zum unteren Rand und öffnet sich dort mit einer Welle. Ohne SVG-Filter, nur transform und opacity.",
  },
] as const;

const toggle =
  "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

export function ToastDropLab() {
  const [tone, setTone] = useState<DropTone>("success");
  const [slow, setSlow] = useState(false);
  const [runs, setRuns] = useState(variants.map(() => 0));

  return (
    <div className="space-y-6">
      <svg aria-hidden="true" className="absolute size-0">
        <filter id={GOO_FILTER_ID} colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -7.5" result="goo" />
          <feMorphology operator="dilate" radius="1" result="grown" />
          <feFlood style={{ floodColor: "var(--border)" }} />
          <feComposite in2="grown" operator="in" result="rim" />
          <feComposite in="goo" in2="rim" operator="over" />
        </filter>
      </svg>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Toast aus der Suche</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vier Richtungen: Der Toast löst sich wie ein Wassertropfen aus der Command Palette und
            geht dann auf. Beim Schließen zieht er sich auf demselben Weg zurück.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            aria-pressed={tone === "error"}
            onClick={() => setTone(tone === "error" ? "success" : "error")}
            className={cn(toggle, tone === "error" && "bg-muted")}
          >
            Fehler
          </button>
          <button
            type="button"
            aria-pressed={slow}
            onClick={() => setSlow(!slow)}
            className={cn(toggle, slow && "bg-muted")}
          >
            Zeitlupe
          </button>
          <button
            type="button"
            onClick={() => setRuns(runs.map((run) => run + 1))}
            className={toggle}
          >
            Alle abspielen
          </button>
          <button
            type="button"
            onClick={() =>
              tone === "error"
                ? toast.error("Verbindung fehlgeschlagen", {
                    description: "Zeitüberschreitung nach 10 s",
                  })
                : toast.success("Änderungen gespeichert", {
                    description: "3 Zeilen in public.orders",
                  })
            }
            className={toggle}
          >
            Echter Toast
          </button>
          <button
            type="button"
            onClick={() =>
              toast.error(
                "Abfrage fehlgeschlagen: Spalte „customer_reference_id“ existiert nicht in public.orders_archive_2025",
                {
                  description:
                    'ERROR: column "customer_reference_id" does not exist at character 58. HINT: Perhaps you meant to reference the column "orders_archive_2025.customer_id". QUERY: SELECT o.id, o.customer_reference_id, o.total_amount FROM public.orders_archive_2025 o WHERE o.created_at > now() - interval \'30 days\' ORDER BY o.created_at DESC LIMIT 500',
                  action: { label: "Erneut versuchen", onClick: () => {} },
                },
              )
            }
            className={toggle}
          >
            Langer Toast
          </button>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {variants.map(({ kind, title, description }, index) => (
          <section key={kind} aria-label={title} className="min-w-0 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="max-w-lg text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
              <button
                type="button"
                onClick={() => setRuns(runs.map((run, at) => (at === index ? run + 1 : run)))}
                className={cn(toggle, "shrink-0 text-xs")}
              >
                Abspielen
              </button>
            </div>
            <ToastDropPreview kind={kind} tone={tone} slow={slow} run={runs[index]} />
          </section>
        ))}
      </div>
    </div>
  );
}
