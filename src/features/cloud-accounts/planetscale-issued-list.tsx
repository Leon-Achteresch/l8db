import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  CLOUD_QUERY_OPTIONS,
  planetScaleCredentials,
  planetScaleRevokeCredential,
} from "@/lib/db/cloud-accounts";
import { cloudErrorText } from "./add-cloud-connection";
import { CloudConfirmButton } from "./cloud-confirm-button";
import { CloudSectionError } from "./cloud-section-error";

export function PlanetScaleIssuedList({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const key = ["cloud-accounts", accountId, "planetscale-issued"] as const;
  const issued = useQuery({
    queryKey: key,
    queryFn: () => planetScaleCredentials(accountId),
    ...CLOUD_QUERY_OPTIONS,
  });

  async function revoke(id: string) {
    setBusy(id);
    try {
      const remaining = await planetScaleRevokeCredential(accountId, id, true);
      queryClient.setQueryData(key, remaining);
      toast.success("Zugangsdaten widerrufen", {
        description:
          "Die zugehörige Verbindung in l8db bleibt erhalten, funktioniert aber nicht mehr.",
      });
    } catch (reason) {
      toast.error(cloudErrorText(reason));
    } finally {
      setBusy(null);
    }
  }

  if (issued.isError) return <CloudSectionError error={issued.error} />;
  const list = issued.data ?? [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase text-muted-foreground">Von l8db ausgestellt</h3>
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">Noch keine Zugangsdaten ausgestellt.</p>
      )}
      <ul className="divide-y rounded-md border text-sm">
        {list.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <KeyRound className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{entry.name}</span>
            <Badge variant="outline">{entry.kind === "postgresql" ? "PostgreSQL" : "MySQL"}</Badge>
            <span className="text-muted-foreground">
              {entry.organization}/{entry.database}/{entry.branch} · {entry.username}
            </span>
            <span className="ml-auto">
              <CloudConfirmButton
                label="Widerrufen"
                variant="ghost"
                busy={busy === entry.id}
                destructive
                title="Zugangsdaten widerrufen?"
                confirmLabel="Widerrufen"
                description={
                  <span>
                    {entry.name} wird bei PlanetScale gelöscht. Verbindungen, die diese Zugangsdaten
                    nutzen, funktionieren danach nicht mehr.
                  </span>
                }
                onConfirm={() => void revoke(entry.id)}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
