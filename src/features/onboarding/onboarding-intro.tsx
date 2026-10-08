import {
  ArrowRight,
  Database,
  LockKeyhole,
  SlidersHorizontal,
  Table2,
  Terminal,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useSettingsStore } from "@/lib/settings";

interface OnboardingIntroProps {
  onComplete: () => void;
}

export function OnboardingIntro({ onComplete }: OnboardingIntroProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  const customizeRef = useRef<HTMLButtonElement>(null);
  const setDone = useSettingsStore((state) => state.setOnboardingDone);
  const quickStart = useNewFeatureVisibility<HTMLButtonElement>(
    "connections.onboarding.quick-start",
  );

  useEffect(() => {
    const previous = document.activeElement;
    startRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setDone(true);
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === startRef.current) {
      event.preventDefault();
      customizeRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === customizeRef.current) {
      event.preventDefault();
      startRef.current?.focus();
    }
  }

  return (
    <div className="onboarding-welcome absolute inset-0 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-14">
        <header className="flex items-center gap-2.5">
          <AppLogo alt="" className="size-8" />
          <span className="text-base font-semibold tracking-tight">l8db</span>
          <span className="ml-3 border-l pl-3 text-xs text-muted-foreground">
            Dein Datenbank-Client
          </span>
        </header>
        <div className="grid flex-1 items-center gap-12 py-12 md:grid-cols-[1.1fr_1fr] md:gap-16">
          <section>
            <p className="eyebrow mb-5">Willkommen an deinem Arbeitsplatz</p>
            <h1 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
              Deine Daten.
              <br />
              Dein Arbeitsplatz.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
              Öffne eine Datenbank, finde die richtige Tabelle und bring deine nächste Abfrage auf
              den Punkt.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                ref={(element) => {
                  startRef.current = element;
                  return quickStart.ref(element);
                }}
                size="lg"
                className="h-11 gap-3 px-5"
                onClick={() => setDone(true)}
                onKeyDown={handleKeyDown}
              >
                Direkt loslegen
                <ArrowRight className="size-4" />
              </Button>
              <Button
                ref={customizeRef}
                variant="ghost"
                className="h-11 px-3"
                onClick={onComplete}
                onKeyDown={handleKeyDown}
              >
                <SlidersHorizontal className="size-4" />
                Erst einrichten
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Design, Treiber und Erweiterungen kannst du jederzeit anpassen.
            </p>
            <div className="mt-10 space-y-4 border-t pt-6">
              <div className="flex items-center gap-3 text-sm">
                <Database aria-hidden="true" className="size-4 text-primary" />
                <span>SQL, NoSQL und lokale Dateien an einem Ort</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Table2 aria-hidden="true" className="size-4 text-primary" />
                <span>Daten durchsuchen, bearbeiten und exportieren</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Terminal aria-hidden="true" className="size-4 text-primary" />
                <span>Abfragen schreiben oder mit KI entwickeln</span>
              </div>
            </div>
          </section>
          <div
            aria-hidden="true"
            className="welcome-preview hidden overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/5 md:block"
          >
            <div className="flex items-center gap-2 border-b bg-muted/35 px-5 py-4 text-xs">
              <Database className="size-4 text-primary" />
              <span className="font-medium">Mein Arbeitsplatz</span>
              <span className="ml-auto rounded border px-2 py-0.5 text-[10px] text-muted-foreground">
                SQL
              </span>
            </div>
            <div className="flex items-center gap-2 border-b px-5 py-3 text-xs text-muted-foreground">
              <Terminal className="size-3.5" />
              Neue Abfrage
            </div>
            <div className="space-y-2 border-b px-5 py-7 font-mono text-[12px] leading-relaxed">
              <p>
                <span className="mr-4 text-muted-foreground/50">1</span>
                <span className="text-primary">SELECT</span> name, status
              </p>
              <p>
                <span className="mr-4 text-muted-foreground/50">2</span>
                <span className="text-primary">FROM</span> projects
              </p>
              <p>
                <span className="mr-4 text-muted-foreground/50">3</span>
                <span className="text-primary">WHERE</span> status ={" "}
                <span className="text-emerald-700 dark:text-emerald-400">'active'</span>
                {";"}
              </p>
            </div>
            <div className="grid grid-cols-[1fr_6rem] border-b bg-muted/35 px-5 py-2.5 text-[11px] font-medium text-muted-foreground">
              <span>name</span>
              <span>status</span>
            </div>
            {["Website", "Analytics", "Mobile App"].map((name) => (
              <div
                key={name}
                className="grid grid-cols-[1fr_6rem] border-b border-border/60 px-5 py-3 text-xs"
              >
                <span>{name}</span>
                <span className="text-muted-foreground">active</span>
              </div>
            ))}
            <div className="flex items-center gap-2 px-5 py-3 text-[10px] text-muted-foreground">
              <Table2 className="size-3" />3 Zeilen<span className="ml-auto">Beispielvorschau</span>
            </div>
          </div>
        </div>
        <footer className="flex flex-wrap items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
          <LockKeyhole aria-hidden="true" className="size-3.5" />
          Passwörter im System-Schlüsselbund. Diagnosedaten nur mit deiner Zustimmung.
        </footer>
      </div>
    </div>
  );
}
