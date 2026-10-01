import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ExtensionDescriptor, Json } from "@/lib/extensions/contracts";
import { useExtensionHost } from "@/lib/extensions/react-context";
import { BitwardenLoginForm } from "./bitwarden-login-form";
import { KeeperLoginForm } from "./keeper-login-form";
import { OnePasswordLoginForm } from "./one-password-login-form";
import { OpenBaoLoginForm } from "./openbao-login-form";
import {
  errorText,
  hasCommand,
  type VaultProvider,
  type VaultStatus,
  vaultProvider,
  vaultSetup,
} from "./password-manager";
import { SetupStep } from "./setup-step";
import { VaultProviderPicker } from "./vault-provider-picker";
import { VaultReadyPanel } from "./vault-ready-panel";

export function PasswordManagerSetup({ extension }: { extension: ExtensionDescriptor }) {
  const host = useExtensionHost();
  const id = extension.archive.manifest.id;
  const provider = vaultProvider(extension.configuration["vault.provider"]);
  const [choosing, setChoosing] = useState(!provider);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(provider?.id);
  current.current = provider?.id;
  const firstState = useRef<{ provider?: string; state?: string }>({});

  const call = useCallback(
    async (action: string, request: Record<string, Json> = {}) => {
      const target = current.current;
      if (!target) return;
      setBusy(action);
      setError(null);
      try {
        const next = await vaultSetup(host, { ...request, action, provider: target });
        if (current.current === target) setStatus(next);
      } catch (cause) {
        if (current.current === target) setError(errorText(cause));
      } finally {
        if (current.current === target) setBusy(null);
      }
    },
    [host],
  );

  const providerId = provider?.id;
  useEffect(() => {
    if (!providerId || choosing) return;
    setStatus(null);
    setBusy(null);
    setError(null);
    void call("status");
  }, [providerId, choosing, call]);

  const choose = async (next: VaultProvider) => {
    try {
      if (next !== provider?.id)
        await host.setConfiguration(id, { ...extension.configuration, "vault.provider": next });
      setChoosing(false);
    } catch (cause) {
      toast.error(errorText(cause));
    }
  };

  const live = status?.provider === provider?.id ? status : null;
  if (live && firstState.current.provider !== live.provider)
    firstState.current = { provider: live.provider, state: live.state };
  const signedIn = live?.state === "signed-in";
  const step = !provider || choosing ? 1 : !live?.cli ? 2 : signedIn ? 4 : 3;
  const state = (index: number) => (index < step ? "done" : index === step ? "active" : "upcoming");
  const onLogin = (input: Record<string, Json>) => void call("login", input);
  const onRefresh = () => void call("status");
  const onLogout = () => void call("logout");
  const onAnswer = (input: Record<string, Json>) => void call("answer", input);

  if (!hasCommand(extension, "vault.setup"))
    return (
      <Alert>
        <AlertDescription className="text-pretty">
          Version {extension.archive.manifest.version} ist veraltet und kann weder die CLI
          installieren noch dich anmelden. Aktualisiere die Erweiterung über den Marktplatz oder
          über das Menü „…“ → „Aus Datei aktualisieren“.
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-4">
      <p className="text-xs text-pretty text-muted-foreground">
        l8db speichert deine Verbindungen samt Passwort im Passwortmanager und lädt sie beim Start
        von dort. Zugänge, die dein Team dort teilt, kommen automatisch dazu.
      </p>
      <ol>
        <SetupStep
          index={1}
          title="Passwortmanager wählen"
          state={state(1)}
          summary={provider?.name}
          action={
            step > 1 && (
              <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => setChoosing(true)}>
                Ändern
              </Button>
            )
          }
        >
          <VaultProviderPicker value={provider?.id} onChange={(next) => void choose(next)} />
        </SetupStep>
        <SetupStep
          index={2}
          title="Kommandozeilen-Tool einrichten"
          state={state(2)}
          summary={live?.cli && `${provider?.name}-CLI ${live.cli}`}
        >
          {!live && !error ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              Suche die {provider?.name}-CLI …
            </p>
          ) : !live ? (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={onRefresh}>
              Erneut prüfen
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                l8db spricht über die offizielle {provider?.name}-CLI mit deinem Tresor. Sie ist auf
                diesem Gerät noch nicht installiert.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!!busy} onClick={() => void call("install")}>
                  {busy === "install" && <Spinner />}
                  {busy === "install" ? "Wird installiert …" : "Jetzt installieren"}
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={onRefresh}>
                  Erneut prüfen
                </Button>
                <Button
                  size="sm"
                  variant="link"
                  className="text-muted-foreground"
                  onClick={() => provider && void openUrl(provider.manual)}
                >
                  Manuelle Anleitung
                </Button>
              </div>
              {busy === "install" && (
                <p className="text-xs text-muted-foreground">
                  Das kann ein paar Minuten dauern. Du kannst die Einstellungen solange offen
                  lassen.
                </p>
              )}
            </div>
          )}
        </SetupStep>
        <SetupStep
          index={3}
          title="Anmelden"
          state={state(3)}
          summary={
            signedIn &&
            [live.account ? `Angemeldet als ${live.account}` : "Angemeldet", live.server]
              .filter(Boolean)
              .join(" · ")
          }
          action={
            signedIn && (
              <Button size="xs" variant="ghost" disabled={!!busy} onClick={onLogout}>
                {busy === "logout" && <Spinner />}
                Abmelden
              </Button>
            )
          }
        >
          {live && provider?.id === "bitwarden" && (
            <BitwardenLoginForm status={live} busy={!!busy} onLogin={onLogin} onLogout={onLogout} />
          )}
          {live && provider?.id === "1password" && (
            <OnePasswordLoginForm
              status={live}
              busy={!!busy}
              onLogin={onLogin}
              onRefresh={onRefresh}
            />
          )}
          {live && provider?.id === "keeper" && (
            <KeeperLoginForm
              status={live}
              busy={!!busy}
              onLogin={onLogin}
              onAnswer={onAnswer}
              onCancel={onLogout}
              onRefresh={onRefresh}
            />
          )}
          {live && provider?.id === "openbao" && (
            <OpenBaoLoginForm
              status={live}
              busy={!!busy}
              onLogin={onLogin}
              onAnswer={onAnswer}
              onCancel={onLogout}
            />
          )}
        </SetupStep>
      </ol>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {signedIn && step === 4 && provider && (
        <VaultReadyPanel
          extension={extension}
          provider={provider}
          autoStart={firstState.current.state !== "signed-in"}
        />
      )}
    </div>
  );
}
