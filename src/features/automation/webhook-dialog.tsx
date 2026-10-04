import { PlusIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { WEBHOOK_KINDS } from "@/lib/automation/format";
import { toast } from "@/lib/automation/toast";
import { storeSecret } from "@/lib/db";
import { testAutomationChannel, type WebhookKind, type WebhookTarget } from "@/lib/db/automation";

interface Props {
  open: boolean;
  webhook: WebhookTarget | null;
  onOpenChange: (open: boolean) => void;
  onSave: (webhook: WebhookTarget) => Promise<unknown>;
}

interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

let rowId = 0;

export function WebhookDialog({ open, webhook, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WebhookKind>("slack");
  const [url, setUrl] = useState("");
  const [sign, setSign] = useState(false);
  const [secret, setSecret] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [id, setId] = useState("");
  const editing = Boolean(webhook);

  useEffect(() => {
    if (!open) return;
    setId(webhook?.id ?? crypto.randomUUID());
    setName(webhook?.name ?? "");
    setKind(webhook?.kind ?? "slack");
    setSign(webhook?.sign ?? false);
    setHeaders(
      Object.entries(webhook?.headers ?? {}).map(([key, value]) => ({ id: ++rowId, key, value })),
    );
    setUrl("");
    setSecret("");
  }, [open, webhook]);

  const urlValid = url === "" ? editing : /^https?:\/\/\S+$/i.test(url.trim());
  const signedBefore = Boolean(webhook?.sign);
  const valid = name.trim() !== "" && urlValid && (!sign || signedBefore || secret !== "");
  const meta = WEBHOOK_KINDS.find((entry) => entry.value === kind) ?? WEBHOOK_KINDS[0];

  const persist = async () => {
    const target: WebhookTarget = {
      id,
      name: name.trim(),
      kind,
      sign,
      headers: Object.fromEntries(
        headers.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]),
      ),
    };
    if (url.trim()) await storeSecret(`automation:webhook:${id}`, url.trim());
    if (sign && secret) await storeSecret(`automation:webhook:${id}:hmac`, secret);
    await onSave(target);
    setUrl("");
    setSecret("");
    return target;
  };

  const run = async (mode: "save" | "test") => {
    setBusy(mode);
    try {
      const saved = await persist();
      if (mode === "test") {
        await testAutomationChannel({ type: "webhook", webhookId: saved.id });
        toast.success("Testnachricht gesendet");
      } else {
        toast.success(`Webhook „${saved.name}“ gespeichert`);
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg" data-testid="automation-webhook-dialog">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void run("save");
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "Webhook bearbeiten" : "Webhook anlegen"}</DialogTitle>
            <DialogDescription>
              Die Adresse enthält oft ein Geheimnis. Sie liegt deshalb im Schlüsselbund.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="webhook-name">Name</Label>
              <Input
                id="webhook-name"
                value={name}
                placeholder="#ops-alerts"
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="webhook-kind">Dienst</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as WebhookKind)}>
                <SelectTrigger id="webhook-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEBHOOK_KINDS.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="webhook-url">Adresse</Label>
              <Input
                id="webhook-url"
                type="url"
                value={url}
                spellCheck={false}
                autoComplete="off"
                placeholder={editing ? "Unverändert – zum Ersetzen neu eingeben" : meta.placeholder}
                aria-invalid={(!urlValid && url !== "") || undefined}
                onChange={(event) => setUrl(event.target.value)}
              />
              {!urlValid && url !== "" && (
                <p className="text-xs text-destructive">Die Adresse muss mit https:// beginnen.</p>
              )}
            </div>
            {kind === "generic" && (
              <div className="col-span-2 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Header</span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setHeaders((rows) => [...rows, { id: ++rowId, key: "", value: "" }])
                    }
                  >
                    <PlusIcon />
                    Header
                  </Button>
                </div>
                {headers.length === 0 && (
                  <p className="text-xs text-muted-foreground">Keine zusätzlichen Header.</p>
                )}
                {headers.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <Input
                      value={row.key}
                      placeholder="Name"
                      aria-label="Header-Name"
                      spellCheck={false}
                      className="h-8 flex-1 font-mono text-xs"
                      onChange={(event) =>
                        setHeaders((rows) =>
                          rows.map((entry) =>
                            entry.id === row.id ? { ...entry, key: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <Input
                      value={row.value}
                      placeholder="Wert, auch ${task}"
                      aria-label="Header-Wert"
                      spellCheck={false}
                      className="h-8 flex-[2] font-mono text-xs"
                      onChange={(event) =>
                        setHeaders((rows) =>
                          rows.map((entry) =>
                            entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <IconButton
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Header entfernen"
                      onClick={() =>
                        setHeaders((rows) => rows.filter((entry) => entry.id !== row.id))
                      }
                    >
                      <XIcon />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <div className="col-span-2 flex items-start justify-between gap-4 rounded-xl bg-muted/50 px-3.5 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor="webhook-sign">Anfragen signieren</Label>
                <span className="text-xs text-pretty text-muted-foreground">
                  Sendet X-L8db-Signature (HMAC-SHA256), damit der Empfänger die Herkunft prüfen
                  kann.
                </span>
              </div>
              <Switch id="webhook-sign" checked={sign} onCheckedChange={setSign} />
            </div>
            {sign && (
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="webhook-secret">Signatur-Schlüssel</Label>
                <Input
                  id="webhook-secret"
                  type="password"
                  value={secret}
                  autoComplete="new-password"
                  placeholder={signedBefore ? "Unverändert" : "Gemeinsames Geheimnis"}
                  onChange={(event) => setSecret(event.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={!valid || Boolean(busy)}
              onClick={() => void run("test")}
            >
              {busy === "test" ? <Spinner className="size-3.5" /> : <SendIcon />}
              Test senden
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => onOpenChange(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={!valid || Boolean(busy)}>
                {busy === "save" && <Spinner className="size-3.5" />}
                Speichern
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
