import { Link } from "@tanstack/react-router";
import type { Update } from "@tauri-apps/plugin-updater";
import { Check, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/app-logo";
import { useUpdatePrompt } from "@/lib/hooks/use-update-prompt";
import { extractHighlights } from "@/lib/markdown";
import { useSettingsStore } from "@/lib/settings";
import { closeUpdatePrompt, getAppVersion, installUpdateAndRelaunch } from "@/lib/updater";

function publishedLabel(date: string | undefined): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

export function UpdateAvailableDialog() {
  const { update, open } = useUpdatePrompt();
  const skippedUpdateVersion = useSettingsStore((s) => s.skippedUpdateVersion);
  const setSkippedUpdateVersion = useSettingsStore((s) => s.setSkippedUpdateVersion);
  const visibleUpdate =
    update && update.version !== skippedUpdateVersion ? update : null;
  const [percent, setPercent] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const busy = percent !== null;
  const visible = open && visibleUpdate !== null;
  const highlights = visibleUpdate?.body ? extractHighlights(visibleUpdate.body) : [];
  const published = publishedLabel(visibleUpdate?.date);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getAppVersion().then((version) => {
      if (!cancelled) setCurrentVersion(version);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || busy) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeUpdatePrompt();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, visible]);

  async function onInstall(next: Update) {
    setFailed(false);
    setPercent(0);
    try {
      await installUpdateAndRelaunch(next, setPercent);
    } catch {
      setPercent(null);
      setFailed(true);
    }
  }

  function onDismiss() {
    if (busy) return;
    setFailed(false);
    closeUpdatePrompt();
  }

  function onSkip() {
    if (busy || !visibleUpdate) return;
    const version = visibleUpdate.version;
    setFailed(false);
    setSkippedUpdateVersion(version);
    closeUpdatePrompt();
    toast.success(`Version ${version} wird übersprungen`, {
      description: "Du kannst sie jederzeit in den Einstellungen installieren.",
      action: {
        label: "Rückgängig",
        onClick: () => setSkippedUpdateVersion(null),
      },
    });
  }

  return (
    <AnimatePresence>
      {visible && visibleUpdate ? (
        <motion.div
          layout
          role="region"
          aria-label={`Version ${visibleUpdate.version} ist verfügbar`}
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 12 }}
          transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.8 }}
          className="fixed right-4 bottom-4 z-[200] w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[26px] border border-border/80 bg-card text-card-foreground shadow-2xl backdrop-blur-xl"
        >
          <div className="relative flex h-36 w-full select-none items-center justify-center overflow-hidden bg-gradient-to-br from-primary/90 via-primary to-chart-2">
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/15" />
            <AppLogo
              alt=""
              className="relative z-10 size-12 shadow-lg ring-2 ring-white/20"
            />
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              aria-label="Schließen"
              className="absolute right-3 top-3 z-20 flex size-7 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white disabled:pointer-events-none disabled:opacity-0"
            >
              <X className="size-4 stroke-[2.5]" />
            </button>
          </div>

          <div className="space-y-3.5 p-5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">l8db v{visibleUpdate.version}</h2>
                <span className="rounded-full border border-primary/25 bg-primary/15 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-primary">
                  Neu
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Eine neue Version steht bereit.
              </p>
            </div>

            {highlights.length > 0 ? (
              <div className="space-y-2">
                {highlights.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-2.5 text-xs leading-snug text-foreground/90"
                  >
                    <Check className="mt-0.5 size-3.5 shrink-0 stroke-[2.5] text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">v{visibleUpdate.version}</span>
              {currentVersion ? (
                <span className="text-xs text-muted-foreground line-through">
                  v{currentVersion}
                </span>
              ) : null}
              <span className="text-[0.6875rem] text-muted-foreground">
                {published ? `• ${published}` : "• Bereit zur Installation"}
              </span>
            </div>

            {busy ? (
              <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/40 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Update wird installiert</span>
                  <span className="font-mono text-muted-foreground">{percent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            ) : null}

            {failed ? (
              <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                Update konnte nicht installiert werden. Bitte erneut versuchen.
              </p>
            ) : null}

            <Button
              type="button"
              size="lg"
              className="h-11 w-full rounded-2xl"
              disabled={busy}
              onClick={() => void onInstall(visibleUpdate)}
            >
              {busy ? `Installiert … ${percent}%` : "Jetzt installieren"}
            </Button>

            <Link
              to="/release-notes"
              onClick={onDismiss}
              className="block text-center text-xs font-medium text-muted-foreground underline-offset-3 hover:text-foreground hover:underline"
            >
              Alle Release Notes
            </Link>

            {busy ? null : (
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="py-0.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Später
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  className="py-0.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Diese Version überspringen
                </button>
              </div>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
