import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FolderOpen, KeyRound, RefreshCw, TerminalSquare, Trash2 } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { ThesvgIcon } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeEndpoint } from "@/lib/ai/context";
import { AI_LOCAL_ENDPOINTS, AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import { type AiProfile, type AiStatus, aiSetKey, aiStatus } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useHasNewFeatures } from "@/lib/new-features";
import { AiCheckButton } from "./ai-check-button";
import { AiMcpServerDialog } from "./ai-mcp-server-dialog";
import { aiProviderSvg } from "./ai-provider-icons";
import { AiSettingsKeyField } from "./ai-settings-key-field";
import { AiSettingsProviderRow } from "./ai-settings-provider-row";
import { AiUsageSettings } from "./ai-usage-settings";

type Mode = "cli" | "byok";
const EASE = [0.22, 1, 0.36, 1] as const;
const MODES = [
  { id: "cli", label: "CLI-Agent", icon: TerminalSquare },
  { id: "byok", label: "API oder lokal", icon: KeyRound },
] as const;
const LOCAL = ["ollama", "lmstudio"];
const LOCAL_URLS: Record<string, string> = {
  ollama: "https://ollama.com/download",
  lmstudio: "https://lmstudio.ai",
};
const KEY_URLS: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/apikey",
};
const PANEL = {
  enter: (dir: number) => ({
    opacity: 0,
    filter: "blur(4px)",
    transform: `translateX(${dir * 16}px)`,
  }),
  center: {
    opacity: 1,
    filter: "blur(0px)",
    transform: "translateX(0px)",
    transition: { duration: 0.28, ease: EASE, staggerChildren: 0.035, delayChildren: 0.03 },
  },
  exit: (dir: number) => ({
    opacity: 0,
    filter: "blur(4px)",
    transform: `translateX(${dir * -16}px)`,
    transition: { duration: 0.12, ease: EASE },
  }),
};
const ITEM = {
  enter: { opacity: 0, transform: "translateY(6px)" },
  center: {
    opacity: 1,
    transform: "translateY(0px)",
    transition: { duration: 0.26, ease: EASE },
  },
};

interface Props {
  profile: AiProfile;
  cwd: string;
  setCwd: (cwd: string) => void;
  refresh: () => void;
  onError: (message: string) => void;
}
export function AiSettings({ profile, cwd, setCwd, refresh, onError }: Props) {
  const controlId = useId();
  const profiles = useAiStore((state) => state.profiles);
  const saveProfile = useAiStore((state) => state.saveProfile);
  const servers = useAiStore((state) => state.servers);
  const saveServer = useAiStore((state) => state.saveServer);
  const activeCli = AI_PROVIDERS.find((entry) => entry.id === profile.provider)?.cli ?? true;
  const [mode, setMode] = useState<Mode>(activeCli ? "cli" : "byok");
  const [expanded, setExpanded] = useState<Record<Mode, string | null>>({
    cli: activeCli ? profile.id : null,
    byok: activeCli ? null : profile.id,
  });
  const [statuses, setStatuses] = useState<Record<string, AiStatus | "checking" | null>>({});
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ cli: null, byok: null });
  const features = useNewFeatureVisibility<HTMLDivElement>("ai.providers");
  const mcpFeature = useNewFeatureVisibility<HTMLDivElement>("ai.context.mcp");
  const localFeature = useNewFeatureVisibility<HTMLDivElement>(
    mode === "byok" ? "ai.providers.local" : undefined,
  );
  const localNew = useHasNewFeatures("ai.providers.local");
  const activeServers = servers.filter((server) => !server.deleted);
  const check = useCallback(async (entry: AiProfile) => {
    setStatuses((current) => ({ ...current, [entry.id]: "checking" }));
    const status = await aiStatus(entry).catch(() => null);
    setStatuses((current) => ({ ...current, [entry.id]: status }));
  }, []);
  useEffect(() => {
    for (const entry of useAiStore.getState().profiles) void check(entry);
  }, [check]);
  const recheck = async (entry: AiProfile) => {
    await check(entry);
    if (entry.id === profile.id) refresh();
  };
  const profileFor = (id: string) => profiles.find((entry) => entry.id === id);
  const statusOf = (id: string) => {
    const status = statuses[id];
    return status && status !== "checking" ? status : null;
  };
  const ready = (cli: boolean) =>
    AI_PROVIDERS.filter((entry) => {
      const status = statusOf(entry.id);
      return (
        entry.cli === cli &&
        (cli || LOCAL.includes(entry.id) ? status?.installed : status?.keyStored)
      );
    }).length;
  const anyKey = ready(false) > 0;
  const switchMode = (next: Mode) => {
    setMode(next);
    tabs.current[next]?.focus();
  };
  const onTabKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "Home") switchMode("cli");
    else if (event.key === "ArrowRight" || event.key === "End") switchMode("byok");
  };
  const pickPath = (apply: (path: string) => void, directory = true) =>
    void open({ directory, multiple: false })
      .then((path) => {
        if (typeof path === "string") apply(path);
      })
      .catch((error) => onError(String(error)));
  const toggle = (id: string) =>
    setExpanded((current) => ({ ...current, [mode]: current[mode] === id ? null : id }));
  const cliRows = AI_PROVIDERS.filter((entry) => entry.cli).map((provider) => {
    const entry = profileFor(provider.id);
    if (!entry) return null;
    const raw = statuses[provider.id];
    const status = statusOf(provider.id);
    const version = status?.version?.split("\n")[0];
    return (
      <motion.li key={provider.id} variants={ITEM}>
        <AiSettingsProviderRow
          id={provider.id}
          name={provider.name}
          active={profile.id === provider.id}
          open={expanded.cli === provider.id}
          onToggle={() => toggle(provider.id)}
          tone={raw === "checking" ? "checking" : status?.installed ? "ready" : "idle"}
          status={
            raw === "checking"
              ? "Wird gesucht …"
              : status?.installed
                ? version || "Installiert"
                : raw === null
                  ? "Status unbekannt"
                  : "Nicht gefunden"
          }
        >
          {raw !== "checking" && !status?.installed && (
            <p className="rounded-xl bg-amber-500/[0.08] px-2.5 py-2 text-amber-700 ring-1 ring-amber-500/20 ring-inset dark:text-amber-300">
              {provider.name} wurde nicht gefunden. Installiere die CLI oder gib den vollständigen
              Pfad zur ausführbaren Datei an.
            </p>
          )}
          <label className="block space-y-1" htmlFor={`${controlId}-binary`}>
            <span>CLI-Befehl oder Pfad</span>
            <div className="flex gap-1.5">
              <Input
                id={`${controlId}-binary`}
                spellCheck={false}
                className="font-mono placeholder:font-sans"
                placeholder={provider.binary}
                value={entry.binary}
                onChange={(event) => saveProfile({ ...entry, binary: event.target.value })}
                onBlur={() => void recheck(entry)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Ausführbare Datei auswählen"
                title="Ausführbare Datei auswählen"
                onClick={() =>
                  pickPath((path) => {
                    const next = { ...entry, binary: path };
                    saveProfile(next);
                    void recheck(next);
                  }, false)
                }
              >
                <FolderOpen className="size-4" />
              </Button>
            </div>
          </label>
          {provider.id !== "opencode" && (
            <label className="block space-y-1" htmlFor={`${controlId}-home`}>
              <span>Konfigurationsverzeichnis</span>
              <div className="flex gap-1.5">
                <Input
                  id={`${controlId}-home`}
                  spellCheck={false}
                  className="font-mono placeholder:font-sans"
                  placeholder="Standardkonfiguration verwenden"
                  value={entry.home}
                  onChange={(event) => saveProfile({ ...entry, home: event.target.value })}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Konfigurationsverzeichnis auswählen"
                  title="Konfigurationsverzeichnis auswählen"
                  onClick={() => pickPath((path) => saveProfile({ ...entry, home: path }))}
                >
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </label>
          )}
          <div className="flex flex-wrap items-start gap-2">
            <Button size="xs" variant="ghost" onClick={() => void recheck(entry)}>
              <RefreshCw /> Erneut prüfen
            </Button>
            {status?.installed && <AiCheckButton profile={entry} />}
          </div>
        </AiSettingsProviderRow>
      </motion.li>
    );
  });
  const byokRows = AI_PROVIDERS.filter((entry) => !entry.cli).map((provider) => {
    const entry = profileFor(provider.id);
    if (!entry) return null;
    const raw = statuses[provider.id];
    const status = statusOf(provider.id);
    const compatible = provider.id === "compatible";
    const local = LOCAL.includes(provider.id);
    return (
      <motion.li key={provider.id} variants={ITEM}>
        <AiSettingsProviderRow
          id={provider.id}
          name={provider.name.replace(" · API", "")}
          active={profile.id === provider.id}
          open={expanded.byok === provider.id}
          onToggle={() => toggle(provider.id)}
          tone={
            raw === "checking"
              ? "checking"
              : (local ? status?.installed : status?.keyStored)
                ? "ready"
                : "idle"
          }
          status={
            raw === "checking"
              ? "Wird geprüft …"
              : local
                ? status?.installed
                  ? "Server läuft"
                  : "Server nicht erreichbar"
                : status?.keyStored
                  ? "Schlüssel hinterlegt"
                  : compatible
                    ? entry.endpoint
                      ? "Eigener Server"
                      : "Endpoint fehlt"
                    : "Kein Schlüssel"
          }
        >
          {local && !status?.installed && raw !== "checking" && (
            <p className="rounded-xl bg-amber-500/[0.08] px-2.5 py-2 text-amber-700 ring-1 ring-amber-500/20 ring-inset dark:text-amber-300">
              {provider.id === "ollama"
                ? "Ollama läuft nicht. Installiere Ollama, lade ein Modell mit „ollama pull llama3.2“ und prüfe erneut."
                : "LM Studio antwortet nicht. Lade ein Modell und starte unter „Developer“ den lokalen Server."}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() =>
                  void openUrl(LOCAL_URLS[provider.id]).catch((error) => onError(String(error)))
                }
              >
                Download
              </button>
            </p>
          )}
          <AiSettingsKeyField
            profileId={provider.id}
            stored={Boolean(status?.keyStored)}
            optional={compatible || local}
            keyUrl={KEY_URLS[provider.id]}
            onChanged={() => recheck(entry)}
            onError={onError}
          />
          <label className="block space-y-1" htmlFor={`${controlId}-endpoint`}>
            <span className="flex items-baseline justify-between gap-2">
              <span>API-Endpoint</span>
              {!compatible && !local && (
                <span className="text-[11px] text-muted-foreground">optional</span>
              )}
            </span>
            <Input
              key={provider.id}
              id={`${controlId}-endpoint`}
              aria-label="API-Endpoint"
              spellCheck={false}
              className="font-mono placeholder:font-sans"
              placeholder={
                compatible
                  ? "https://api.example.com/v1"
                  : (AI_LOCAL_ENDPOINTS[provider.id] ?? "Standard-Endpoint")
              }
              defaultValue={entry.endpoint}
              onBlur={(event) => {
                try {
                  const next = { ...entry, endpoint: safeEndpoint(event.target.value) };
                  saveProfile(next);
                  if (local) void recheck(next);
                } catch (error) {
                  onError(String(error));
                }
              }}
            />
          </label>
          {(local ? status?.installed : status?.keyStored || (compatible && entry.endpoint)) && (
            <AiCheckButton profile={entry} />
          )}
        </AiSettingsProviderRow>
      </motion.li>
    );
  });
  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-6 p-4 text-xs">
        <div ref={features.ref} className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">AI-Anbieter</h3>
              <p className="mt-0.5 text-muted-foreground text-pretty">
                Arbeite mit deiner lokalen CLI, einem API-Schlüssel oder einem lokalen Modell wie
                Ollama.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Modelle & Fähigkeiten aktualisieren"
              title="Modelle & Fähigkeiten aktualisieren"
              onClick={() => {
                for (const entry of profiles) void check(entry);
                refresh();
              }}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          <div
            role="tablist"
            aria-label="Art der Anbindung"
            onKeyDown={onTabKey}
            className="grid grid-cols-2 rounded-xl bg-muted/70 p-1"
          >
            {MODES.map((entry) => {
              const selected = mode === entry.id;
              const count = ready(entry.id === "cli");
              return (
                <button
                  key={entry.id}
                  ref={(node) => {
                    tabs.current[entry.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${controlId}-tab-${entry.id}`}
                  aria-selected={selected}
                  aria-controls={`${controlId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setMode(entry.id)}
                  className="relative isolate flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium text-muted-foreground outline-none transition-[color,scale] duration-150 ease-smooth-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] aria-selected:text-foreground"
                >
                  {selected && (
                    <motion.span
                      layoutId={`${controlId}-pill`}
                      className="absolute inset-0 -z-10 rounded-lg bg-background shadow-[0_1px_2px_rgb(0_0_0/0.06),0_2px_8px_-2px_rgb(0_0_0/0.12)] dark:bg-input/60"
                      transition={{ type: "spring", duration: 0.32, bounce: 0 }}
                    />
                  )}
                  <entry.icon className="size-3.5" />
                  {entry.label}
                  {entry.id === "byok" && localNew && mode !== "byok" && <NewBadge />}
                  {count > 0 && (
                    <span className="grid min-w-4 place-items-center rounded-full bg-emerald-500/15 px-1 text-[10px] tabular-nums text-emerald-700 dark:text-emerald-300">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <AnimatePresence mode="wait" initial={false} custom={mode === "byok" ? 1 : -1}>
              <motion.div
                key={mode}
                id={`${controlId}-panel`}
                role="tabpanel"
                aria-labelledby={`${controlId}-tab-${mode}`}
                custom={mode === "byok" ? 1 : -1}
                variants={PANEL}
                initial="enter"
                animate="center"
                exit="exit"
                className="space-y-3"
              >
                {mode === "cli" ? (
                  <>
                    <motion.p variants={ITEM} className="px-1 text-muted-foreground text-pretty">
                      Nutzt Login, Tools, Skills und MCP-Server der CLI, die auf diesem Rechner
                      installiert ist.
                    </motion.p>
                    <ul className="-mx-2 space-y-1">{cliRows}</ul>
                    <motion.label
                      variants={ITEM}
                      className="block space-y-1 rounded-2xl bg-muted/40 p-3"
                      htmlFor={`${controlId}-cwd`}
                    >
                      <span className="font-medium">Arbeitsverzeichnis</span>
                      <span className="block text-muted-foreground">
                        Hier starten die Agenten und suchen nach Projekt-Skills.
                      </span>
                      <span className="flex gap-1.5 pt-1">
                        <Input
                          id={`${controlId}-cwd`}
                          spellCheck={false}
                          className="bg-background font-mono placeholder:font-sans"
                          value={cwd}
                          onChange={(event) => setCwd(event.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Arbeitsverzeichnis auswählen"
                          onClick={() => pickPath(setCwd)}
                        >
                          <FolderOpen className="size-4" />
                        </Button>
                      </span>
                    </motion.label>
                  </>
                ) : (
                  <>
                    <motion.div
                      ref={localFeature.ref}
                      variants={ITEM}
                      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/[0.07] via-muted/40 to-muted/20 p-3.5 ring-1 ring-border/60 ring-inset"
                    >
                      <div className="flex items-center">
                        {["openai", "anthropic", "google", "compatible"].map((id, index) => {
                          const svg = aiProviderSvg(id);
                          return (
                            <motion.span
                              key={id}
                              initial={{ opacity: 0, transform: "translateX(-6px) scale(0.9)" }}
                              animate={{ opacity: 1, transform: "translateX(0px) scale(1)" }}
                              transition={{ duration: 0.3, ease: EASE, delay: 0.06 + index * 0.05 }}
                              className="-ml-1.5 grid size-7 place-items-center rounded-full bg-background shadow-[0_0_0_2px_var(--color-background),0_1px_3px_rgb(0_0_0/0.12)] first:ml-0"
                            >
                              {svg ? (
                                <ThesvgIcon svg={svg} className="size-3.5" />
                              ) : (
                                <KeyRound className="size-3.5 text-muted-foreground" />
                              )}
                            </motion.span>
                          );
                        })}
                      </div>
                      <h4 className="mt-3 flex items-center gap-1.5 text-[13px] font-medium">
                        Bring your own key oder lokal
                        {localFeature.isNew && <NewBadge />}
                      </h4>
                      <p className="mt-1 text-muted-foreground text-pretty">
                        Verbinde l8db direkt mit OpenAI, Anthropic, Google oder einem
                        OpenAI-kompatiblen Server. Abgerechnet wird bei deinem Anbieter. Mit Ollama
                        oder LM Studio bleibt alles auf deinem Rechner.
                      </p>
                      {!anyKey && (
                        <ol className="mt-3 space-y-1.5">
                          {[
                            "Schlüssel beim Anbieter erstellen",
                            "Unten beim Anbieter einfügen und speichern",
                            "Im Chat Anbieter und Modell wählen",
                          ].map((step, index) => (
                            <li key={step} className="flex items-center gap-2">
                              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-background text-[10px] font-medium tabular-nums ring-1 ring-border">
                                {index + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                      )}
                      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <KeyRound className="size-3" />
                        Schlüssel liegen nur im Schlüsselbund deines Systems.
                      </p>
                    </motion.div>
                    <ul className="-mx-2 space-y-1">{byokRows}</ul>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <motion.section
          layout="position"
          transition={{ duration: 0.28, ease: EASE }}
          className="space-y-4 border-t pt-5"
        >
          <h3 className="text-sm font-medium">Weitere Einstellungen</h3>
          <div ref={mcpFeature.ref} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">MCP-Server</div>
                <div className="text-muted-foreground">Zusätzliche Tools für jeden Agenten.</div>
              </div>
              <AiMcpServerDialog onError={onError} />
            </div>
            {activeServers.length ? (
              <ul className="space-y-1">
                <AnimatePresence initial={false}>
                  {activeServers.map((server) => (
                    <motion.li
                      key={server.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{
                        opacity: 1,
                        height: "auto",
                        transition: { duration: 0.24, ease: EASE },
                      }}
                      exit={{ opacity: 0, height: 0, transition: { duration: 0.16, ease: EASE } }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 py-1 pr-1 pl-3">
                        <span className="min-w-0 truncate">
                          {server.name}
                          <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                            {server.transport}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${server.name} entfernen`}
                          onClick={() => {
                            saveServer(server, true);
                            void aiSetKey(`mcp-${server.id}`, "").catch((error) =>
                              onError(String(error)),
                            );
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed px-3 py-2.5 text-muted-foreground">
                Native Server der CLI bleiben verfügbar. Eigene Server erscheinen im Plus-Menü des
                Chats.
              </p>
            )}
          </div>
          <AiUsageSettings profile={profile} />
        </motion.section>
      </div>
    </MotionConfig>
  );
}
