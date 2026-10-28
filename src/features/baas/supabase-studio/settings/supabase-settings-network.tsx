import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { NameConfirmDialog } from "@/features/versioning/database/name-confirm-dialog";
import {
  supabaseStudioSettingsNetworkRestrictions,
  supabaseStudioSettingsSslEnforcement,
  supabaseStudioSettingsUpdateSslEnforcement,
} from "@/lib/db/supabase-studio-settings";

export function SupabaseSettingsNetwork({ reference }: { reference: string }) {
  const queryClient = useQueryClient();
  const sslKey = ["supabase", reference, "studio-settings-ssl"];
  const ssl = useQuery({
    queryKey: sslKey,
    queryFn: () => supabaseStudioSettingsSslEnforcement(reference),
  });
  const network = useQuery({
    queryKey: ["supabase", reference, "studio-settings-network"],
    queryFn: () => supabaseStudioSettingsNetworkRestrictions(reference),
  });
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enforced = ssl.data?.currentConfig?.database === true;
  const cidrs = [
    ...(network.data?.config?.dbAllowedCidrs ?? []),
    ...(network.data?.config?.dbAllowedCidrsV6 ?? []),
  ];

  async function apply(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(
        sslKey,
        await supabaseStudioSettingsUpdateSslEnforcement(reference, enabled),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Netzwerk & SSL</h3>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border bg-background/50 p-3">
        <div>
          <p className="text-xs font-medium">SSL erzwingen</p>
          <p className="text-[11px] text-muted-foreground">
            Lehnt unverschlüsselte Verbindungen zur Datenbank ab.
          </p>
        </div>
        {ssl.isPending ? (
          <span className="text-xs text-muted-foreground">…</span>
        ) : ssl.isError ? (
          <span role="alert" className="max-w-xs text-xs text-destructive">
            {String(ssl.error)}
          </span>
        ) : (
          <Switch
            checked={enforced}
            disabled={busy}
            aria-label="SSL erzwingen"
            onCheckedChange={(value) => setPending(value)}
          />
        )}
      </div>
      {ssl.data?.appliedSuccessfully === false && (
        <p className="mt-2 text-xs text-muted-foreground">Änderung wird noch angewendet.</p>
      )}
      <div className="mt-3 rounded-lg border bg-background/50 p-3">
        <p className="text-xs font-medium">Netzwerkbeschränkungen</p>
        {network.isPending ? (
          <p className="mt-1 text-xs text-muted-foreground">Wird geladen…</p>
        ) : network.isError ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {String(network.error)}
          </p>
        ) : cidrs.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Keine Beschränkung: Alle IP-Adressen dürfen sich verbinden.
          </p>
        ) : (
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto font-mono text-xs">
            {cidrs.slice(0, 200).map((cidr) => (
              <li key={cidr}>{cidr}</li>
            ))}
          </ul>
        )}
        {network.data?.status && (
          <p className="mt-1 text-[11px] text-muted-foreground">Status: {network.data.status}</p>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {pending !== null && (
        <NameConfirmDialog
          title={pending ? "SSL erzwingen?" : "SSL-Erzwingung aufheben?"}
          description={
            pending
              ? "Clients ohne SSL können sich danach nicht mehr verbinden. Supabase startet dafür die Datenbank kurz neu."
              : "Danach sind auch unverschlüsselte Verbindungen erlaubt. Supabase startet dafür die Datenbank kurz neu."
          }
          name=""
          requireName={false}
          action="Übernehmen"
          destructive
          onConfirm={() => void apply(pending)}
          onClose={() => setPending(null)}
        />
      )}
    </section>
  );
}
