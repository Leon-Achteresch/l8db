import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Json } from "@/lib/extensions/contracts";
import type { VaultStatus } from "./password-manager";
import { VaultField } from "./vault-field";

const METHODS = [
  { id: "email", label: "Link per E-Mail" },
  { id: "push", label: "Keeper Push" },
  { id: "sms", label: "Code per 2FA" },
];

const SENT: Record<string, string> = {
  email:
    "Keeper hat dir eine E-Mail geschickt. Klicke auf den Link darin und dann auf „Weiter“, oder gib den Code aus der E-Mail ein.",
  push: "Bestätige die Anmeldung auf deinem anderen Gerät und klicke dann auf „Weiter“.",
  sms: "Gib den Code ein, den du gerade bekommen hast.",
};

export function KeeperApproval({
  status,
  busy,
  onAnswer,
  onCancel,
}: {
  status: VaultStatus;
  busy: boolean;
  onAnswer: (input: Record<string, Json>) => void;
  onCancel: () => void;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const device = status.needs === "device";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAnswer(code.trim() ? { code: code.trim() } : { method: "resume" });
    setCode("");
  };

  if (status.needs === "2fa")
    return (
      <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
        <p className="text-xs">Keeper fragt nach einem zweiten Faktor. Wähle die Methode.</p>
        <div className="flex flex-wrap gap-2">
          {status.channels?.map((channel) => (
            <Button
              key={channel.id}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAnswer({ channel: channel.id })}
            >
              {channel.label}
            </Button>
          ))}
        </div>
        {status.detail && <p className="text-xs text-destructive">{status.detail}</p>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    );

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3"
    >
      <p className="text-xs text-pretty">
        {device
          ? "Keeper möchte dieses Gerät bestätigen. Wähle, wie du die Anmeldung freigibst."
          : "Gib den Code aus deiner Authenticator-App oder SMS ein."}
      </p>
      {device && (
        <div className="flex flex-wrap gap-2">
          {METHODS.map((method) => (
            <Button
              key={method.id}
              type="button"
              size="sm"
              variant={sent === method.id ? "secondary" : "outline"}
              disabled={busy}
              onClick={() => {
                setSent(method.id);
                onAnswer({ method: method.id });
              }}
            >
              {method.label}
            </Button>
          ))}
        </div>
      )}
      {device && sent && <p className="text-xs text-muted-foreground">{SENT[sent]}</p>}
      <VaultField
        label={device ? "Bestätigungscode (optional)" : "Bestätigungscode"}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={!device}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      {status.detail && <p className="text-xs text-destructive">{status.detail}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || (!device && !code.trim())}>
          {busy && <Spinner />}
          {device && !code.trim() ? "Weiter" : "Bestätigen"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
