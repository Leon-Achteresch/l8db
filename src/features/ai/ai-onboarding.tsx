import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageSquareText,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wand2,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useId, useState } from "react";
import { ThesvgIcon } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiReady } from "@/lib/ai/setup";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import { copyText } from "@/lib/clipboard";
import { aiSetKey, aiStatus } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { AiOnboardingStepper } from "./ai-onboarding-stepper";
import { aiProviderSvg } from "./ai-provider-icons";

const EASE = [0.22, 1, 0.36, 1] as const;
const STEPS = ["Zugang", "Anbieter", "Verbinden", "Fertig"];
const DETAILS: Record<string, { text: string; install?: string; keyUrl?: string }> = {
  codex: { text: "OpenAI Codex mit deinem ChatGPT-Abo", install: "@openai/codex" },
  claude: { text: "Claude Code mit deinem Claude-Abo", install: "@anthropic-ai/claude-code" },
  "gemini-cli": {
    text: "Gemini im Terminal mit deinem Google-Konto",
    install: "@google/gemini-cli",
  },
  opencode: { text: "Open Source, beliebige Modelle", install: "opencode-ai" },
  copilot: { text: "GitHub Copilot mit deinem GitHub-Konto", install: "@github/copilot" },
  openai: {
    text: "GPT-Modelle über die OpenAI API",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    text: "Claude-Modelle über die Anthropic API",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  google: {
    text: "Gemini-Modelle über Google AI Studio",
    keyUrl: "https://aistudio.google.com/apikey",
  },
};
const FEATURES = [
  { icon: MessageSquareText, text: "Fragen zu deinen Daten in natürlicher Sprache" },
  { icon: Wand2, text: "SQL schreiben, erklären und optimieren" },
  { icon: ShieldCheck, text: "Schreibzugriffe nur mit deiner Freigabe" },
];
const PANEL = {
  enter: (dir: number) => ({
    opacity: 0,
    filter: "blur(4px)",
    transform: `translateX(${dir * 24}px)`,
  }),
  center: {
    opacity: 1,
    filter: "blur(0px)",
    transform: "translateX(0px)",
    transition: { duration: 0.32, ease: EASE, staggerChildren: 0.04, delayChildren: 0.04 },
  },
  exit: (dir: number) => ({
    opacity: 0,
    filter: "blur(4px)",
    transform: `translateX(${dir * -24}px)`,
    transition: { duration: 0.16, ease: EASE },
  }),
};
const ITEM = {
  enter: { opacity: 0, transform: "translateY(8px)" },
  center: { opacity: 1, transform: "translateY(0px)", transition: { duration: 0.3, ease: EASE } },
};

function logo(id: string, className: string) {
  const svg = aiProviderSvg(id);
  return svg ? <ThesvgIcon svg={svg} className={className} /> : <Server className={className} />;
}

interface Props {
  onDone: (profileId: string) => void;
  onSettings: () => void;
}
export function AiOnboarding({ onDone, onSettings }: Props) {
  const id = useId();
  const profiles = useAiStore((state) => state.profiles);
  const saveProfile = useAiStore((state) => state.saveProfile);
  const [[step, dir], setStep] = useState([0, 1]);
  const [cli, setCli] = useState(true);
  const [providerId, setProviderId] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState("");
  const feature = useNewFeatureVisibility<HTMLDivElement>("ai.onboarding");
  const provider = AI_PROVIDERS.find((entry) => entry.id === providerId);
  const profile = profiles.find((entry) => entry.id === providerId);
  const details = DETAILS[providerId] ?? { text: "" };
  const install = `npm install -g ${details.install ?? ""}`;
  const go = (next: number) => {
    setProblem("");
    setStep([next, next > step ? 1 : -1]);
  };
  const verify = async () => {
    if (!profile) return;
    setBusy(true);
    setProblem("");
    try {
      if (!cli) await aiSetKey(profile.id, key.trim());
      const status = await aiStatus(profile);
      if (aiReady(profile, status)) {
        setKey("");
        setVersion(status.version?.split("\n")[0] ?? "");
        go(3);
      } else
        setProblem(
          cli
            ? `${provider?.name} wurde nicht gefunden. Liegt die CLI nicht im PATH, trage unten den vollständigen Pfad ein.`
            : "Der Schlüssel konnte nicht gespeichert werden.",
        );
    } catch (error) {
      setProblem(String(error));
    } finally {
      setBusy(false);
    }
  };
  const card = (selected: boolean) =>
    cn(
      "group flex w-full items-start gap-3 rounded-2xl border bg-background/80 p-3 text-left shadow-xs outline-none backdrop-blur transition-[border-color,box-shadow,transform] duration-200 ease-smooth-out hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
      selected && "border-primary/60 ring-1 ring-primary/20",
    );
  const content =
    step === 0 ? (
      <>
        <motion.div variants={ITEM} className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex items-center">
            <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/15 blur-2xl" />
            {["claude", "codex", "anthropic", "gemini-cli", "openai"].map((entry, index) => (
              <motion.span
                key={entry}
                initial={{ opacity: 0, transform: "translateY(10px) scale(0.8)" }}
                animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                transition={{ delay: 0.08 + index * 0.05, duration: 0.4, ease: EASE }}
                className={cn(
                  "grid size-10 place-items-center rounded-xl border bg-background shadow-sm",
                  index && "-ml-2",
                  index === 2 && "z-10 size-12 border-primary/30",
                )}
              >
                {index === 2 ? <Sparkles className="size-5 text-primary" /> : logo(entry, "size-5")}
              </motion.span>
            ))}
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-balance">
              KI für deine Datenbanken einrichten
            </h2>
            <p className="mx-auto max-w-sm text-xs text-pretty text-muted-foreground">
              Verbinde einen KI-Agenten in wenigen Schritten. Deine Daten bleiben auf deinem
              Rechner, bis du eine Frage stellst.
            </p>
          </div>
        </motion.div>
        <motion.ul variants={ITEM} className="grid gap-1.5 @md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground @md:flex-col @md:items-start"
            >
              <Icon className="size-3.5 shrink-0 text-primary" />
              {text}
            </li>
          ))}
        </motion.ul>
        <motion.div variants={ITEM} className="space-y-2">
          <h3 className="text-xs font-medium">Wie möchtest du KI nutzen?</h3>
          <div className="grid gap-2 @md:grid-cols-2">
            {[
              {
                value: true,
                icon: TerminalSquare,
                title: "Lokaler CLI-Agent",
                text: "Nutzt dein bestehendes Abo, z. B. Claude Code oder Codex.",
              },
              {
                value: false,
                icon: KeyRound,
                title: "Eigener API-Schlüssel",
                text: "Bring your own key für OpenAI, Anthropic oder Google.",
              },
            ].map((entry) => (
              <button
                key={entry.title}
                type="button"
                className={card(false)}
                onClick={() => {
                  setCli(entry.value);
                  setProviderId("");
                  go(1);
                }}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-transform duration-200 ease-smooth-out group-hover:scale-110">
                  <entry.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-xs font-medium">{entry.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{entry.text}</span>
                </span>
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-smooth-out group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </motion.div>
      </>
    ) : step === 1 ? (
      <>
        <motion.div variants={ITEM} className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">Anbieter wählen</h2>
          <p className="text-xs text-muted-foreground">
            {cli
              ? "Welchen Agenten möchtest du verwenden? Du kannst später jederzeit wechseln."
              : "Für welchen Anbieter hast du einen API-Schlüssel?"}
          </p>
        </motion.div>
        <ul className="grid gap-2 @md:grid-cols-2">
          {AI_PROVIDERS.filter((entry) => entry.cli === cli && DETAILS[entry.id]).map((entry) => (
            <motion.li key={entry.id} variants={ITEM}>
              <button
                type="button"
                className={card(entry.id === providerId)}
                onClick={() => {
                  setProviderId(entry.id);
                  go(2);
                }}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted transition-transform duration-200 ease-smooth-out group-hover:scale-110">
                  {logo(entry.id, "size-4")}
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-xs font-medium">{entry.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {DETAILS[entry.id].text}
                  </span>
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      </>
    ) : step === 2 ? (
      <>
        <motion.div variants={ITEM} className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-background shadow-sm">
            {logo(providerId, "size-5")}
          </span>
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-base font-semibold tracking-tight">{provider?.name} verbinden</h2>
            <p className="text-xs text-muted-foreground">{details.text}</p>
          </div>
        </motion.div>
        {cli ? (
          <ol className="space-y-3 text-xs">
            <motion.li variants={ITEM} className="space-y-1.5">
              <span className="font-medium">1. Installieren</span>
              <div className="flex items-center gap-2 rounded-xl border bg-muted/40 py-1.5 pr-1.5 pl-3 font-mono text-[11px]">
                <span className="text-muted-foreground select-none">$</span>
                <code className="min-w-0 flex-1 truncate">{install}</code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Befehl kopieren"
                  onClick={() =>
                    void copyText(install).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
            </motion.li>
            <motion.li variants={ITEM} className="space-y-1">
              <span className="font-medium">2. Anmelden</span>
              <p className="text-muted-foreground">
                Starte <code className="rounded bg-muted px-1 py-px">{provider?.binary}</code>{" "}
                einmal im Terminal und melde dich mit deinem Konto an.
              </p>
            </motion.li>
            <motion.li variants={ITEM} className="space-y-1">
              <span className="font-medium">3. Prüfen</span>
              <p className="text-muted-foreground">
                l8db sucht die CLI und verwendet deinen bestehenden Login.
              </p>
            </motion.li>
          </ol>
        ) : (
          <motion.div variants={ITEM} className="space-y-2 text-xs">
            <label htmlFor={`${id}-key`} className="flex items-center justify-between gap-2">
              <span className="font-medium">API-Schlüssel</span>
              {details.keyUrl && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                  onClick={() => void openUrl(details.keyUrl ?? "")}
                >
                  Schlüssel erstellen
                  <ExternalLink className="size-3" />
                </button>
              )}
            </label>
            <Input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Schlüssel einfügen"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && key.trim() && !busy) void verify();
              }}
            />
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0" />
              Wird sicher im Schlüsselbund deines Betriebssystems gespeichert.
            </p>
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {problem && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="overflow-hidden"
            >
              <div
                role="alert"
                className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs"
              >
                <p className="text-destructive">{problem}</p>
                {cli && profile && (
                  <label htmlFor={`${id}-binary`} className="block space-y-1">
                    <span className="text-muted-foreground">CLI-Befehl oder Pfad</span>
                    <Input
                      id={`${id}-binary`}
                      value={profile.binary}
                      onChange={(event) => saveProfile({ ...profile, binary: event.target.value })}
                    />
                  </label>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div variants={ITEM}>
          <Button
            className="w-full"
            disabled={busy || (!cli && !key.trim())}
            onClick={() => void verify()}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {cli ? "Installation prüfen" : "Speichern und prüfen"}
          </Button>
        </motion.div>
      </>
    ) : (
      <motion.div variants={ITEM} className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="relative grid size-16 place-items-center">
          <motion.span
            className="absolute inset-0 rounded-full bg-emerald-500/15"
            initial={{ transform: "scale(0.4)", opacity: 0 }}
            animate={{ transform: "scale(1)", opacity: 1 }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.35 }}
          />
          <motion.span
            className="grid size-11 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
            initial={{ transform: "scale(0)" }}
            animate={{ transform: "scale(1)" }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.45, delay: 0.08 }}
          >
            <Check className="size-6" strokeWidth={2.5} />
          </motion.span>
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{provider?.name} ist bereit</h2>
          <p className="text-xs text-muted-foreground">
            {version || "Alles eingerichtet."} Stelle jetzt deine erste Frage zu deinen Daten.
          </p>
        </div>
        <Button className="min-w-40" onClick={() => onDone(providerId)}>
          Los geht&apos;s
          <ArrowRight className="size-3.5" />
        </Button>
      </motion.div>
    );
  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={feature.ref}
        className="@container relative flex min-h-0 flex-1 flex-col overflow-auto"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-radial-[ellipse_at_top] from-primary/12 to-transparent to-70%"
        />
        <div className="relative mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-6">
          <AiOnboardingStepper steps={STEPS} current={step === 3 ? 4 : step} />
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.section
              key={step}
              custom={dir}
              variants={PANEL}
              initial="enter"
              animate="center"
              exit="exit"
              aria-label={STEPS[step]}
              className="flex flex-col gap-5"
            >
              {content}
            </motion.section>
          </AnimatePresence>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            {step > 0 && step < 3 ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => go(step - 1)}>
                <ArrowLeft className="size-3.5" />
                Zurück
              </Button>
            ) : (
              <span />
            )}
            {step < 3 && (
              <Button
                variant="link"
                size="sm"
                className="text-muted-foreground"
                onClick={onSettings}
              >
                Eigener Endpoint und weitere Optionen
              </Button>
            )}
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
