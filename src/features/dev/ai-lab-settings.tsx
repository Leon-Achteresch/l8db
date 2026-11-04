import { Check, Search, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const history = [
  "Umsatzrückgang verstehen",
  "Kundenabfrage verbessern",
  "Oktoberbericht vorbereiten",
  "Datenmodell kennenlernen",
];

export function AiLabSettings() {
  const id = useId();
  const [provider, setProvider] = useState("Codex CLI");
  const [model, setModel] = useState("Standard des Anbieters");
  const [effort, setEffort] = useState("Hoch");
  const [query, setQuery] = useState("");
  const [tested, setTested] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <section
      aria-label="KI-Einrichtungsvorschau"
      className="grid h-full min-h-0 overflow-auto @min-[760px]:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="space-y-6 p-6 sm:p-9">
        <div>
          <Badge variant="outline">1 Anbieter · 2 Verbindung · 3 Test</Badge>
          <h3 className="mt-4 text-2xl font-semibold tracking-tight">
            Ein Anbieter. Ein Test. Bereit.
          </h3>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            CLI-Anmeldung, eigener API-Schlüssel oder lokales Modell.
          </p>
        </div>
        <fieldset aria-label="KI-Anbieter in der Vorschau" className="grid gap-2 sm:grid-cols-3">
          {["Codex CLI", "Eigener API-Key", "Lokales Modell"].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === provider}
              onClick={() => {
                setProvider(value);
                setTested(false);
              }}
              className={cn(
                "rounded-xl border p-4 text-left text-xs font-medium outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring",
                value === provider && "border-primary bg-primary/5",
              )}
            >
              <span className="mb-3 block text-primary">
                {value === provider ? (
                  <Check className="size-4" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
              </span>
              {value}
            </button>
          ))}
        </fieldset>
        <div className="space-y-5 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">{provider}</h4>
            <Badge variant="secondary">Beispielprofil</Badge>
          </div>
          {provider !== "Codex CLI" && (
            <div className="space-y-2">
              <label htmlFor={`${id}-endpoint`} className="text-xs text-muted-foreground">
                {provider === "Lokales Modell" ? "Lokaler Endpunkt" : "Schlüssel-Vorschau"}
              </label>
              <Input
                id={`${id}-endpoint`}
                readOnly
                value={
                  provider === "Lokales Modell"
                    ? "http://localhost:11434"
                    : "•••••••• · kein echter Schlüssel"
                }
                className="font-mono text-xs"
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor={`${id}-model`} className="text-xs text-muted-foreground">
                Modell
              </label>
              <Input
                id={`${id}-model`}
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setTested(false);
                }}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-effort`} className="text-xs text-muted-foreground">
                Reasoning
              </label>
              <select
                id={`${id}-effort`}
                value={effort}
                onChange={(event) => setEffort(event.target.value)}
                className="h-9 w-full rounded-lg border bg-background px-3 text-xs"
              >
                {["Niedrig", "Mittel", "Hoch"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-xs leading-6">
            <b>Freigaben bewusst wählen</b>
            <p className="text-muted-foreground">
              Vorschlag: lesende interne Datenbank-Werkzeuge automatisch. Schreibzugriffe, externe
              Tools und Shell fragen separat.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => setTested(true)} disabled={!model.trim()}>
              Verbindungstest simulieren
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setFailed(!failed);
                setTested(false);
              }}
            >
              {failed ? "Erfolg simulieren" : "Fehler simulieren"}
            </Button>
          </div>
          {tested && (
            <p
              role="status"
              className={cn("text-xs leading-6", failed ? "text-destructive" : "text-primary")}
            >
              {failed
                ? "Beispiel: Anbieter nicht erreichbar. Modell und Endpunkt prüfen oder einen anderen Anbieter wählen."
                : "Beispieltest erfolgreich. Es wurde keine Verbindung zu einem Anbieter hergestellt."}
            </p>
          )}
        </div>
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-xs font-medium">Erweiterte Einstellungen</summary>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Kontextlimit, Kostenmodell und CLI-Pfad gehören in einen aufklappbaren Bereich. Echte
            Einstellungen bleiben in dieser Vorschau unverändert.
          </p>
        </details>
      </div>
      <aside className="space-y-5 border-t bg-muted/20 p-5 @min-[760px]:border-t-0 @min-[760px]:border-l">
        <h4 className="text-sm font-medium">Verlauf wiederfinden</h4>
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Beispielgespräche durchsuchen"
            placeholder="Gespräche durchsuchen …"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9 text-xs"
          />
        </div>
        {history
          .filter((title) => title.toLowerCase().includes(query.toLowerCase()))
          .map((title) => (
            <div key={title} className="space-y-2 rounded-xl border bg-card p-4">
              <p className="text-xs font-medium">{title}</p>
              <p className="text-[11px] text-muted-foreground">Shop · Beispielgespräch</p>
            </div>
          ))}
        <p className="text-[11px] leading-6 text-muted-foreground">
          Große Verläufe erst beim Öffnen laden. Für die Liste reichen Titel, Verbindung und
          Zeitpunkt.
        </p>
      </aside>
    </section>
  );
}
