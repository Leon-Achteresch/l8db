import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { Json } from "@/lib/extensions/contracts";
import type { VaultStatus } from "./password-manager";

export function OnePasswordLoginForm({
  status,
  busy,
  onLogin,
  onRefresh,
}: {
  status: VaultStatus;
  busy: boolean;
  onLogin: (input: Record<string, Json>) => void;
  onRefresh: () => void;
}) {
  const accounts = status.accounts ?? [];
  const [account, setAccount] = useState(accounts[0]?.id ?? "");

  if (!accounts.length)
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          l8db meldet sich über die 1Password-App an. Einmalig die CLI-Integration einschalten:
        </p>
        <ol className="list-inside list-decimal space-y-1 rounded-xl bg-muted/60 p-3 text-xs">
          <li>1Password-App öffnen und entsperren</li>
          <li>Einstellungen → Entwickler</li>
          <li>„Mit 1Password CLI integrieren“ aktivieren</li>
        </ol>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRefresh}>
          {busy && <Spinner />}
          Erneut prüfen
        </Button>
      </div>
    );

  return (
    <div className="space-y-3">
      {accounts.length > 1 && (
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger aria-label="1Password-Konto" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {accounts.length === 1 && (
        <p className="text-xs text-muted-foreground">
          Konto: <span className="font-medium text-foreground">{accounts[0].label}</span>
        </p>
      )}
      <Button size="sm" disabled={busy} onClick={() => onLogin({ account })}>
        {busy && <Spinner />}
        Mit 1Password anmelden
      </Button>
      <p className="text-xs text-muted-foreground">
        Bestätige die Anfrage danach in der 1Password-App, zum Beispiel mit Touch ID.
      </p>
    </div>
  );
}
