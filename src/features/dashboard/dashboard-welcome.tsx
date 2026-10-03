import {
  ArrowRightIcon,
  DatabaseIcon,
  FolderOpenIcon,
  LayoutDashboardIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHARTS, type ChartKind } from "@/lib/dashboards";
import { ChartKindPreview } from "./chart-kind-preview";

const EXAMPLES: { kind: ChartKind; question: string; description: string }[] = [
  {
    kind: "line",
    question: "Wie entwickelt sich mein Umsatz?",
    description: "Veränderungen über Tage, Monate oder Jahre sehen.",
  },
  {
    kind: "column",
    question: "Was läuft am besten?",
    description: "Produkte, Teams oder Regionen miteinander vergleichen.",
  },
  {
    kind: "donut",
    question: "Wie verteilen sich meine Daten?",
    description: "Anteile und Schwerpunkte auf einen Blick erkennen.",
  },
];

export function DashboardWelcome({
  connectionName,
  onCreate,
  onOpen,
}: {
  connectionName: string;
  onCreate: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-muted/15">
      <header className="flex items-center justify-between gap-3 border-b bg-background px-6 py-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <LayoutDashboardIcon className="size-4" /> Dashboards
        </span>
        <span className="inline-flex max-w-64 items-center gap-2 truncate">
          <DatabaseIcon className="size-3.5 shrink-0" /> {connectionName}
        </span>
      </header>
      <main className="mx-auto w-full max-w-5xl px-6 py-12 lg:py-16">
        <div className="max-w-xl">
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            Deine Daten, deine Perspektive
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Aus Daten wird ein Überblick.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
            Stelle Kennzahlen und Charts zu deinem Dashboard zusammen. Wähle deine Daten und
            gestalte Auswertungen visuell — direkt aus deiner Datenbank.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={onCreate}>
              <PlusIcon /> Dashboard erstellen
            </Button>
            <Button variant="ghost" onClick={onOpen}>
              <FolderOpenIcon /> Aus Datei öffnen
            </Button>
          </div>
        </div>
        <div className="mt-12 flex items-center justify-between gap-3 border-t pt-5">
          <h2 className="text-sm font-medium">Welche Frage möchtest du beantworten?</h2>
          <span className="text-xs text-muted-foreground">
            {Object.keys(CHARTS).length} Charttypen
          </span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {EXAMPLES.map(({ kind, question, description }) => (
            <div key={kind} className="rounded-xl border border-border/70 bg-card p-5">
              <ChartKindPreview kind={kind} className="mb-5 h-24 w-full text-primary" />
              <h3 className="text-sm font-medium">{question}</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span>Datenquelle wählen</span>
          <ArrowRightIcon className="size-3" />
          <span>Kennzahlen zusammenstellen</span>
          <ArrowRightIcon className="size-3" />
          <span>Chart gestalten</span>
          <span className="ml-auto text-[11px]">Illustrationen · keine Daten geladen</span>
        </div>
      </main>
    </div>
  );
}
