import { Check, Download, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { installDriver } from "@/lib/db";
import { hintForPlatform, missingDrivers } from "@/lib/drivers";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { loadProviders, useProvidersStore } from "@/lib/providers";

export function OnboardingDrivers() {
  const providers = useProvidersStore((state) => state.providers);
  const loaded = useProvidersStore((state) => state.loaded);
  const feature = useNewFeatureVisibility<HTMLDivElement>("onboarding.drivers");
  const [checking, setChecking] = useState(!loaded);
  const [installing, setInstalling] = useState<string | null>(null);
  const [needed, setNeeded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (loaded) return;
    let active = true;
    void loadProviders().finally(() => {
      if (active) setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [loaded]);

  const refresh = async () => {
    setChecking(true);
    await loadProviders();
    setChecking(false);
  };

  const missing = loaded ? missingDrivers(providers) : [];

  const install = async (id: string) => {
    const provider = missing.find((entry) => entry.id === id);
    if (!provider) return;
    setInstalling(id);
    try {
      await installDriver(provider.kind);
      await loadProviders();
      toast.success(`${provider.name}: Installation abgeschlossen.`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div ref={feature.ref} className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {loaded
            ? missing.length === 0
              ? "Alle Treiber sind bereit."
              : `${missing.length} ${missing.length === 1 ? "Treiber fehlt" : "Treiber fehlen"}. Wähle aus, welche du brauchst.`
            : checking
              ? "Treiber werden geprüft …"
              : "Der Treiberstatus konnte nicht geladen werden."}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={checking || installing !== null}
          onClick={() => void refresh()}
        >
          <RefreshCw className={checking ? "size-3 animate-spin" : "size-3"} />
          Erneut prüfen
        </Button>
      </div>
      {checking && !loaded ? (
        <div className="flex items-center gap-2 rounded-xl border border-border p-5 text-sm text-muted-foreground">
          <Spinner /> Treiber werden geladen …
        </div>
      ) : (
        <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
          {missing.map((provider) => {
            const choice = needed[provider.id];
            const hint =
              provider.driver.type === "odbc" && provider.id !== "odbc"
                ? provider.driver_status.install.find((entry) => entry.os === "all")
                : hintForPlatform(provider.driver_status);
            const automatic =
              provider.driver_status.install_command !== null &&
              (provider.kind === "oracle" || provider.id === "odbc");
            return (
              <section key={provider.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium">{provider.name}</h3>
                    <p className="text-xs text-muted-foreground">{provider.driver_status.detail}</p>
                  </div>
                  <fieldset className="flex gap-1.5">
                    <legend className="sr-only">{provider.name} benötigt?</legend>
                    <Button
                      size="sm"
                      variant={choice === true ? "default" : "outline"}
                      aria-pressed={choice === true}
                      onClick={() => setNeeded((state) => ({ ...state, [provider.id]: true }))}
                    >
                      {choice === true && <Check className="size-3" />}
                      Brauche ich
                    </Button>
                    <Button
                      size="sm"
                      variant={choice === false ? "secondary" : "ghost"}
                      aria-pressed={choice === false}
                      onClick={() => setNeeded((state) => ({ ...state, [provider.id]: false }))}
                    >
                      Nicht nötig
                    </Button>
                  </fieldset>
                </div>
                {choice === true && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {automatic && (
                      <Button
                        size="sm"
                        disabled={installing !== null}
                        onClick={() => void install(provider.id)}
                      >
                        {installing === provider.id ? (
                          <Spinner className="size-3" />
                        ) : (
                          <Download className="size-3" />
                        )}
                        {installing === provider.id ? "Installieren …" : "Jetzt installieren"}
                      </Button>
                    )}
                    {hint && (
                      <a
                        href={hint.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                      >
                        <ExternalLink className="size-3" />
                        {automatic ? "Anleitung" : "Installationsanleitung"}
                      </a>
                    )}
                    {!automatic && !hint && (
                      <span className="text-xs text-muted-foreground">
                        Dieser Treiber ist in diesem Build nicht enthalten.
                      </span>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Du kannst fehlende Treiber später jederzeit unter „Treiber“ einrichten.
      </p>
    </div>
  );
}
