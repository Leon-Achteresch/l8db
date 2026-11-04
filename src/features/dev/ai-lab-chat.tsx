import {
  ArrowDownRight,
  ArrowRight,
  Check,
  Database,
  FlaskConical,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { useState } from "react";
import { TaskRows } from "@/components/primitives/task-rows";
import { Button } from "@/components/ui/button";
import { AiAnswer } from "@/features/ai/ai-answer";
import { AiWorkRow } from "@/features/ai/ai-work-row";
import { cn } from "@/lib/utils";
import { AiLabComposer } from "./ai-lab-composer";
import { type AiLabMessage, type AiLabScene, appendAiLabMessage } from "./ai-lab-data";
import { AiLabResults } from "./ai-lab-results";

const suggestions = [
  {
    icon: ArrowDownRight,
    title: "Veränderung erklären",
    prompt: "Warum ist der Umsatz im Oktober gesunken?",
  },
  {
    icon: SquareTerminal,
    title: "SQL verbessern",
    prompt: "Wie wird meine Kundenabfrage schneller?",
  },
  {
    icon: Database,
    title: "Datenbank verstehen",
    prompt: "Erkläre die wichtigsten Tabellen und Beziehungen.",
  },
  {
    icon: FlaskConical,
    title: "Änderung simulieren",
    prompt: "Was würde sich beim Archivieren der Testkunden ändern?",
  },
];

export function AiLabChat({ scene, narrow = false }: { scene: AiLabScene; narrow?: boolean }) {
  const [phase, setPhase] = useState<"start" | "running" | "done" | "stopped">(
    scene === "start" ? "start" : scene === "running" ? "running" : "done",
  );
  const [messages, setMessages] = useState<AiLabMessage[]>(
    scene === "start"
      ? []
      : [{ id: "initial", text: "Warum ist der Umsatz im Oktober gegenüber September gesunken?" }],
  );
  const [showResults, setShowResults] = useState(scene === "results");
  const send = (text: string) => {
    setMessages((current) => appendAiLabMessage(current, text));
    setPhase("running");
  };
  const running = phase === "running";

  return (
    <div
      className={cn(
        "grid h-full min-h-0 min-w-0",
        showResults &&
          !narrow &&
          "grid-rows-[minmax(0,1fr)_minmax(220px,40%)] @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(300px,38%)] @min-[760px]:grid-rows-1",
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-col">
        <section
          aria-label="Gesprächsvorschau"
          className="min-h-0 flex-1 overflow-auto px-5 py-7 sm:px-8"
        >
          {phase === "start" ? (
            <div className="mx-auto max-w-2xl py-8">
              <div className="mb-5 flex size-11 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
                <Sparkles className="size-5" />
              </div>
              <p className="mb-3 text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
                Deine Daten. Verständlich gemacht.
              </p>
              <h3 className="text-3xl font-semibold tracking-tight">
                Was möchtest du herausfinden?
              </h3>
              <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">
                Analysiere Daten, verstehe dein Schema oder verbessere SQL. Du siehst jeden Schritt
                und entscheidest über Änderungen.
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {suggestions.map(({ icon: Icon, title, prompt }) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => send(prompt)}
                    className="group rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Icon className="mb-4 size-4 text-primary" />
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-5">
              {messages.map(({ id, text }) => (
                <div
                  key={id}
                  data-lab-message
                  className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm border bg-muted/40 px-4 py-3 text-sm leading-6"
                >
                  {text}
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="grid size-6 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="size-3.5" />
                </span>{" "}
                l8db Assistent{" "}
                <span className="font-normal text-muted-foreground">
                  {running
                    ? "· Analyse läuft"
                    : phase === "stopped"
                      ? "· gestoppt"
                      : "· Analyse abgeschlossen"}
                </span>
              </div>
              <TaskRows
                title="Umsatzrückgang untersuchen"
                defaultOpen
                rows={[
                  {
                    id: "source",
                    label: "Zeitraum und Datenquelle prüfen",
                    status: "done",
                    meta: "orders · created_at",
                    details: "September und Oktober 2026 · Europe/Berlin",
                  },
                  {
                    id: "compare",
                    label: "Umsatz nach Kundengruppe vergleichen",
                    status: "done",
                    meta: "2 Gruppen",
                  },
                  {
                    id: "cause",
                    label: "Ursache bei Geschäftskunden prüfen",
                    status: running ? "running" : phase === "stopped" ? "cancelled" : "done",
                    details:
                      "Beispielanalyse: Anzahl Bestellungen und durchschnittlichen Warenkorb getrennt vergleichen.",
                  },
                ]}
              />
              <AiAnswer
                streaming={false}
                text={
                  running
                    ? "**Zwischenergebnis:** Der Rückgang liegt überwiegend bei Geschäftskunden. Ich prüfe, ob weniger Bestellungen oder kleinere Warenkörbe dahinterstehen."
                    : phase === "stopped"
                      ? "Die Analyse wurde gestoppt. Die bisherigen Ergebnisse bleiben sichtbar. Du kannst die Vorschau fortsetzen oder eine neue Frage stellen."
                      : "## Geschäftskunden erklären den Rückgang.\n\nDer Gesamtumsatz sinkt um **18,4 %**. Bei Geschäftskunden fehlen **99.000 €**. Der Privatkundenumsatz bleibt konstant.\n\nWeniger B2B-Bestellungen treiben den Rückgang. Der durchschnittliche Warenkorb bleibt weitgehend stabil."
                }
              />
              <div className="relative pl-6">
                <AiWorkRow
                  icon={Check}
                  label="3 Abfragen · vollständige Beispieldaten"
                  detail="Die Vorschau verwendet feste, lokale Daten. Es wurde keine Datenbankabfrage ausgeführt."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {phase !== "done" && (
                  <Button size="sm" onClick={() => setPhase("done")}>
                    <Check className="size-3.5" />{" "}
                    {running ? "Analyse abschließen" : "Vorschau fortsetzen"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setShowResults(!showResults)}>
                  <ArrowRight className="size-3.5" />{" "}
                  {showResults ? "Ergebnisse schließen" : "Ergebnisse anzeigen"}
                </Button>
                {!running && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => send("Zeig mir die betroffenen Geschäftskunden.")}
                  >
                    Betroffene Kunden zeigen
                  </Button>
                )}
              </div>
              {showResults && narrow && (
                <div className="h-[480px] overflow-hidden rounded-xl border">
                  <AiLabResults />
                </div>
              )}
            </div>
          )}
        </section>
        <AiLabComposer running={running} onSend={send} onStop={() => setPhase("stopped")} />
      </div>
      {showResults && !narrow && (
        <div className="min-h-0 border-t @min-[760px]:border-t-0 @min-[760px]:border-l">
          <AiLabResults />
        </div>
      )}
    </div>
  );
}
