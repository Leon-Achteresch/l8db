import { Feather, Layers, ShieldCheck, ShieldOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { OnboardingChoice } from "@/features/onboarding/onboarding-choice";
import { OnboardingDrivers } from "@/features/onboarding/onboarding-drivers";
import { OnboardingExtensions } from "@/features/onboarding/onboarding-extensions";
import { OnboardingIntro } from "@/features/onboarding/onboarding-intro";
import { OnboardingThemePreview } from "@/features/onboarding/onboarding-theme-preview";
import { EASE_OUT } from "@/lib/ease";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function Onboarding() {
  const done = useSettingsStore((s) => s.onboardingDone);
  const setDone = useSettingsStore((s) => s.setOnboardingDone);
  const easyMode = useSettingsStore((s) => s.easyMode);
  const setEasyMode = useSettingsStore((s) => s.setEasyMode);
  const crashReports = useSettingsStore((s) => s.crashReports);
  const setCrashReports = useSettingsStore((s) => s.setCrashReports);
  const { theme, setTheme } = useTheme();
  const [step, setStep] = useState(0);
  const [shownDone, setShownDone] = useState(done);
  if (shownDone !== done) {
    setShownDone(done);
    if (!done) setStep(0);
  }
  const finishIntro = useCallback(() => setStep((s) => Math.max(s, 1)), []);

  const steps = [
    {
      id: "theme",
      title: "Wie soll l8db aussehen?",
      subtitle:
        "Die Vorschau wird sofort angewendet. Du kannst das später in den Einstellungen ändern.",
      value: theme ?? "system",
      select: setTheme,
      options: [
        {
          value: "light",
          label: "Hell",
          description: "Klar und kontrastreich für helle Umgebungen.",
          preview: <OnboardingThemePreview variant="light" />,
        },
        {
          value: "dark",
          label: "Dunkel",
          description: "Schont die Augen bei langen Sessions.",
          preview: <OnboardingThemePreview variant="dark" />,
        },
        {
          value: "system",
          label: "System",
          description: "Folgt automatisch deinem Betriebssystem.",
          preview: <OnboardingThemePreview variant="system" />,
        },
      ],
    },
    {
      id: "mode",
      title: "Wie viel Werkzeug brauchst du?",
      subtitle: "Deine Wahl lässt sich jederzeit in den Einstellungen umschalten.",
      value: easyMode ? "easy" : "normal",
      select: (value: string) => setEasyMode(value === "easy"),
      options: [
        {
          value: "easy",
          label: "Einfach",
          description:
            "Das Wesentliche: Verbindungen, Tabellen und SQL. Profi-Werkzeuge bleiben ausgeblendet.",
          preview: (
            <div className="flex h-28 items-center justify-center rounded-lg bg-muted">
              <Feather className="size-9 text-primary" />
            </div>
          ),
        },
        {
          value: "normal",
          label: "Normal",
          description:
            "Alles an Bord: Monitor, Versionierung, Replikation, ER-Diagramm, MCP und mehr.",
          preview: (
            <div className="flex h-28 items-center justify-center rounded-lg bg-muted">
              <Layers className="size-9 text-primary" />
            </div>
          ),
        },
      ],
    },
    {
      id: "drivers",
      title: "Welche Treiber brauchst du?",
      subtitle:
        "l8db prüft, welche Treiber auf diesem Gerät fehlen. Installiere nur die, die du verwenden möchtest.",
      content: <OnboardingDrivers />,
    },
    {
      id: "crash-reports",
      title: "Absturzberichte senden?",
      subtitle:
        "Hilft, Fehler schneller zu beheben. Du kannst das jederzeit in den Einstellungen unter Über & Updates ändern.",
      value: crashReports ? "on" : "off",
      select: (value: string) => setCrashReports(value === "on"),
      options: [
        {
          value: "on",
          label: "Berichte senden",
          description:
            "Fehlermeldung, Stacktrace, App-Version und Betriebssystem gehen an Sentry (EU). Verbindungsdaten werden entfernt, SQL und Ergebnisdaten nie gesendet.",
          preview: (
            <div className="flex h-28 items-center justify-center rounded-lg bg-muted">
              <ShieldCheck className="size-9 text-primary" />
            </div>
          ),
        },
        {
          value: "off",
          label: "Nicht senden",
          description:
            "Fehler bleiben lokal in der Log-Datei und lassen sich bei Bedarf als Diagnosepaket exportieren.",
          preview: (
            <div className="flex h-28 items-center justify-center rounded-lg bg-muted">
              <ShieldOff className="size-9 text-primary" />
            </div>
          ),
        },
      ],
    },
    {
      id: "extensions",
      title: "Mach l8db zu deinem Werkzeug",
      subtitle:
        "Offizielle Erweiterungen aus dem Marketplace – mit einem Klick installiert, geprüft per SHA-256.",
      content: <OnboardingExtensions onFinish={() => setDone(true)} />,
    },
  ];
  const current = steps[Math.max(step, 1) - 1];
  const last = step === steps.length;

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          key="onboarding"
          role="dialog"
          aria-modal="true"
          aria-label="Willkommen bei l8db"
          className="fixed inset-0 z-[10000002] overflow-hidden bg-background text-foreground"
          exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          <AnimatePresence>
            {step === 0 ? (
              <OnboardingIntro key="intro" onComplete={finishIntro} />
            ) : (
              <motion.div
                key="steps"
                className="absolute inset-0 flex items-center justify-center overflow-y-auto px-8 py-10"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1, delay: 0.3, ease: EASE_OUT }}
              >
                <div className="w-full max-w-3xl">
                  <div className="mb-8 flex items-center gap-3">
                    <AppLogo className="size-9" />
                    <div>
                      <p className="text-sm font-semibold">Willkommen bei l8db</p>
                      <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                        Schritt {step} von {steps.length}
                      </p>
                    </div>
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={current.id}
                      initial={{ opacity: 0, x: 48, filter: "blur(6px)" }}
                      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, x: -48, filter: "blur(6px)" }}
                      transition={{ duration: 0.35, ease: EASE_OUT }}
                    >
                      <h2 className="text-3xl font-semibold tracking-tight">{current.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">{current.subtitle}</p>
                      {"content" in current ? (
                        current.content
                      ) : (
                        <div
                          className={cn(
                            "mt-8 grid gap-4",
                            current.options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
                          )}
                        >
                          {current.options.map((option, index) => (
                            <OnboardingChoice
                              key={option.value}
                              group={current.id}
                              index={index}
                              selected={current.value === option.value}
                              onSelect={() => current.select(option.value)}
                              title={option.label}
                              description={option.description}
                            >
                              {option.preview}
                            </OnboardingChoice>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>

                  <div className="mt-10 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {steps.map((s, index) => (
                        <motion.span
                          key={s.id}
                          className="h-1.5 rounded-full bg-primary"
                          animate={{
                            width: index + 1 === step ? 24 : 6,
                            opacity: index + 1 === step ? 1 : 0.3,
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {step > 1 && (
                        <Button variant="ghost" onClick={() => setStep(step - 1)}>
                          Zurück
                        </Button>
                      )}
                      <Button onClick={() => (last ? setDone(true) : setStep(step + 1))}>
                        {last ? "Los geht's" : "Weiter"}
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
