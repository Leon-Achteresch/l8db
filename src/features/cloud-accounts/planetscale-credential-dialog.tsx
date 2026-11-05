import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
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
import {
  type PlanetScaleBranch,
  type PlanetScaleDatabase,
  planetScaleCreateCredential,
} from "@/lib/db/cloud-accounts";
import { addCloudConnection, cloudErrorText } from "./add-cloud-connection";
import { CloudField } from "./cloud-field";

export function PlanetScaleCredentialDialog({
  accountId,
  organization,
  database,
  branch,
  open,
  onOpenChange,
}: {
  accountId: string;
  organization: string;
  database: PlanetScaleDatabase;
  branch: PlanetScaleBranch;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const confirmId = useId();
  const [credentialName, setCredentialName] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engine = database.kind === "postgresql" ? "PostgreSQL" : "MySQL";
  const fallbackName = `${organization} / ${database.name} / ${branch.name}`;

  useEffect(() => {
    if (!open) return;
    setConfirmed(false);
    setError(null);
  }, [open]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const issued = await planetScaleCreateCredential(accountId, {
        organization,
        database: database.name,
        branch: branch.name,
        credentialName: credentialName.trim() || null,
        connectionName: connectionName.trim() || fallbackName,
        confirmed: true,
      });
      addCloudConnection(issued.connection);
      await queryClient.invalidateQueries({
        queryKey: ["cloud-accounts", accountId, "planetscale-issued"],
      });
      setCredentialName("");
      setConnectionName("");
      onOpenChange(false);
    } catch (reason) {
      setError(cloudErrorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lesende Zugangsdaten anlegen</DialogTitle>
          <DialogDescription>
            {engine}-Datenbank {database.name}, Branch {branch.name}
            {branch.production ? " (Produktion)" : ""}. PlanetScale legt dafür echte Zugangsdaten
            an, die nur lesen dürfen. Das Passwort landet direkt im Schlüsselbund.
          </DialogDescription>
        </DialogHeader>
        <form
          id="planetscale-credential"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed) void create();
          }}
        >
          <CloudField
            id="ps-credential-name"
            label="Name bei PlanetScale (optional)"
            hint="Bis 63 Zeichen: Buchstaben, Ziffern, - und _. Leer lassen für einen automatischen Namen."
          >
            <Input
              id="ps-credential-name"
              value={credentialName}
              maxLength={63}
              onChange={(event) => setCredentialName(event.target.value)}
              autoComplete="off"
            />
          </CloudField>
          <CloudField id="ps-connection-name" label="Name der Verbindung in l8db">
            <Input
              id="ps-connection-name"
              value={connectionName}
              placeholder={fallbackName}
              maxLength={120}
              onChange={(event) => setConnectionName(event.target.value)}
            />
          </CloudField>
          <div className="flex items-start gap-2 text-sm">
            <Checkbox
              id={confirmId}
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <label htmlFor={confirmId} className="leading-tight">
              Ich möchte bei PlanetScale neue lesende Zugangsdaten anlegen. Sie bleiben gültig, bis
              ich sie hier oder bei PlanetScale widerrufe.
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button type="submit" form="planetscale-credential" disabled={!confirmed || busy}>
            {busy ? "Lege an…" : "Anlegen und verbinden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
