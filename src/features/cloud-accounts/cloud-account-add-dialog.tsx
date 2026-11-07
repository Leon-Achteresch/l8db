import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, LogIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CLOUD_QUERY_OPTIONS,
  type CloudAccount,
  type CloudProvider,
  neonAddApiKey,
  neonOAuthCancel,
  neonOAuthConfig,
  neonOAuthFinish,
  neonOAuthStart,
  planetScaleAddToken,
  spacetimeAdd,
} from "@/lib/db/cloud-accounts";
import { cloudErrorText } from "./add-cloud-connection";
import { CloudField as Field } from "./cloud-field";

export function CloudAccountAddDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (account: CloudAccount) => void;
}) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<CloudProvider>("neon");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [identity, setIdentity] = useState("");
  const [useEndpoint, setUseEndpoint] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const generation = useRef(0);
  const flowRef = useRef<string | null>(null);
  const oauth = useQuery({
    queryKey: ["cloud-accounts", "neon-oauth-config"],
    queryFn: neonOAuthConfig,
    enabled: open,
    ...CLOUD_QUERY_OPTIONS,
  });

  useEffect(() => {
    if (open) return;
    generation.current += 1;
    setSecret("");
    setTokenId("");
    setIdentity("");
    setError(null);
    setBusy(false);
    const pending = flowRef.current;
    flowRef.current = null;
    setFlowId(null);
    if (pending) void neonOAuthCancel(pending).catch(() => undefined);
  }, [open]);

  function finish(account: CloudAccount) {
    setSecret("");
    setTokenId("");
    void queryClient.invalidateQueries({ queryKey: ["cloud-accounts", "list"] });
    toast.success(`Konto „${account.label}“ hinzugefügt`);
    onAdded(account);
    onOpenChange(false);
  }

  async function submit() {
    const run = ++generation.current;
    setBusy(true);
    setError(null);
    const custom = useEndpoint ? endpoint.trim() : null;
    try {
      const account =
        provider === "neon"
          ? await neonAddApiKey(label, secret, custom)
          : provider === "planetscale"
            ? await planetScaleAddToken(label, tokenId, secret, custom)
            : await spacetimeAdd(label, secret, custom, identity);
      if (run === generation.current) finish(account);
    } catch (reason) {
      if (run === generation.current) setError(cloudErrorText(reason));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }

  async function signIn() {
    const run = ++generation.current;
    setBusy(true);
    setError(null);
    let started: string | null = null;
    try {
      const flow = await neonOAuthStart(label);
      started = flow.flow_id;
      if (run !== generation.current) {
        void neonOAuthCancel(flow.flow_id).catch(() => undefined);
        return;
      }
      flowRef.current = flow.flow_id;
      setFlowId(flow.flow_id);
      await openUrl(flow.authorize_url);
      const account = await neonOAuthFinish(flow.flow_id);
      if (run === generation.current) finish(account);
    } catch (reason) {
      if (run === generation.current) setError(cloudErrorText(reason));
    } finally {
      if (flowRef.current === started) flowRef.current = null;
      if (run === generation.current) {
        setBusy(false);
        setFlowId(null);
      }
    }
  }

  function cancelSignIn() {
    const pending = flowRef.current;
    flowRef.current = null;
    generation.current += 1;
    setFlowId(null);
    setBusy(false);
    if (pending) void neonOAuthCancel(pending).catch(() => undefined);
  }

  const canSubmit =
    !busy &&
    secret.trim().length > 0 &&
    (provider !== "planetscale" || tokenId.trim().length > 0) &&
    (!useEndpoint || endpoint.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cloud-Konto hinzufügen</DialogTitle>
          <DialogDescription>
            Zugangsdaten werden nur im Schlüsselbund des Systems gespeichert und nie an die
            Oberfläche zurückgegeben.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={provider}
          onValueChange={(value) => {
            setProvider(value as CloudProvider);
            setSecret("");
            setError(null);
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="neon">Neon</TabsTrigger>
            <TabsTrigger value="planetscale">PlanetScale</TabsTrigger>
            <TabsTrigger value="spacetimedb">SpacetimeDB</TabsTrigger>
          </TabsList>
          <form
            id="cloud-account-add"
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit();
            }}
          >
            <Field id="cloud-account-label" label="Name (optional)">
              <Input
                id="cloud-account-label"
                value={label}
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <TabsContent value="neon" className="flex flex-col gap-3">
              {oauth.data?.available ? (
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <p className="text-sm">Mit deinem Neon-Konto im Browser anmelden.</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => void signIn()}>
                      <LogIn className="size-3.5" />
                      {flowId ? "Warte auf Browser…" : "Mit Neon anmelden"}
                    </Button>
                    {flowId && (
                      <Button type="button" size="sm" variant="ghost" onClick={cancelSignIn}>
                        Anmeldung abbrechen
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  {oauth.data?.reason ??
                    "Die Browser-Anmeldung ist nicht verfügbar. Melde dich mit einem API-Schlüssel an."}
                </p>
              )}
              <Field
                id="cloud-neon-key"
                label="Neon-API-Schlüssel"
                hint="Persönlicher oder Organisations-Schlüssel aus Neon Console → Settings → API keys."
              >
                <Input
                  id="cloud-neon-key"
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <button
                type="button"
                onClick={() => void openUrl("https://console.neon.tech/app/settings/api-keys")}
                className="inline-flex items-center gap-1 self-start text-xs text-primary underline"
              >
                API-Schlüssel in der Neon Console anlegen
                <ExternalLink className="size-3" />
              </button>
            </TabsContent>
            <TabsContent value="planetscale" className="flex flex-col gap-3">
              <Field id="cloud-ps-id" label="Service-Token-ID">
                <Input
                  id="cloud-ps-id"
                  value={tokenId}
                  onChange={(event) => setTokenId(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field
                id="cloud-ps-token"
                label="Service-Token"
                hint="Benötigt read_organization, read_database, read_branch sowie create/delete_branch_password für Zugangsdaten."
              >
                <Input
                  id="cloud-ps-token"
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            </TabsContent>
            <TabsContent value="spacetimedb" className="flex flex-col gap-3">
              <Field
                id="cloud-stdb-token"
                label="SpacetimeDB-Token"
                hint="Ausgabe von `spacetime login show --token` für Maincloud oder deinen lokalen Server."
              >
                <Input
                  id="cloud-stdb-token"
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field
                id="cloud-stdb-identity"
                label="Identität (optional)"
                hint="Nur nötig, wenn das Token keine hex_identity enthält."
              >
                <Input
                  id="cloud-stdb-identity"
                  value={identity}
                  placeholder="c200…"
                  onChange={(event) => setIdentity(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </TabsContent>
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id="cloud-account-endpoint-toggle"
                checked={useEndpoint}
                onCheckedChange={(value) => setUseEndpoint(value === true)}
              />
              <label htmlFor="cloud-account-endpoint-toggle" className="leading-tight">
                Lokalen Entwickler-Endpunkt verwenden
              </label>
            </div>
            {useEndpoint && (
              <Field
                id="cloud-account-endpoint"
                label="Endpunkt"
                hint="Nur 127.0.0.1, ::1 oder localhost, zum Beispiel http://127.0.0.1:3000."
              >
                <Input
                  id="cloud-account-endpoint"
                  value={endpoint}
                  placeholder="http://127.0.0.1:3000"
                  onChange={(event) => setEndpoint(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        </Tabs>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button type="submit" form="cloud-account-add" disabled={!canSubmit}>
            {busy && !flowId ? "Prüfe…" : "Hinzufügen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
