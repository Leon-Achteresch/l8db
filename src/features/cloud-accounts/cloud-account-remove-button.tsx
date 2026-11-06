import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  CLOUD_QUERY_OPTIONS,
  type CloudAccount,
  cloudAccountRemove,
  planetScaleCredentials,
} from "@/lib/db/cloud-accounts";
import { cloudErrorText } from "./add-cloud-connection";
import { CloudConfirmButton } from "./cloud-confirm-button";

export function CloudAccountRemoveButton({
  account,
  onRemoved,
}: {
  account: CloudAccount;
  onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const issued = useQuery({
    queryKey: ["cloud-accounts", account.id, "planetscale-issued"],
    queryFn: () => planetScaleCredentials(account.id),
    enabled: account.provider === "planetscale",
    ...CLOUD_QUERY_OPTIONS,
  });
  const active = issued.data?.length ?? 0;

  async function remove() {
    setBusy(true);
    try {
      await cloudAccountRemove(account.id, active > 0);
      queryClient.removeQueries({ queryKey: ["cloud-accounts", account.id] });
      await queryClient.invalidateQueries({ queryKey: ["cloud-accounts", "list"] });
      toast.success(`Konto „${account.label}“ entfernt`);
      onRemoved();
    } catch (reason) {
      toast.error(cloudErrorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CloudConfirmButton
      label="Konto entfernen"
      variant="ghost"
      icon={<Unplug className="size-3.5" />}
      busy={busy}
      title={`„${account.label}“ entfernen?`}
      confirmLabel="Entfernen"
      destructive
      acknowledgement={
        active > 0
          ? `Ich weiß, dass ${active} ausgestellte Zugangsdaten bei PlanetScale gültig bleiben und hier nicht mehr widerrufen werden können.`
          : undefined
      }
      description={
        <>
          <span>
            Der Kontozugang wird aus dem Schlüsselbund gelöscht. Bereits angelegte
            Datenbankverbindungen und deren Passwörter bleiben unverändert erhalten.
          </span>
          {active > 0 && (
            <span>
              Widerrufe die Zugangsdaten am besten vorher in der Liste „Von l8db ausgestellt“.
            </span>
          )}
        </>
      }
      onConfirm={() => void remove()}
    />
  );
}
