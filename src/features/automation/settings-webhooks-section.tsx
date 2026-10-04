import { PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon, WebhookIcon } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { WEBHOOK_KINDS } from "@/lib/automation/format";
import { toast } from "@/lib/automation/toast";
import { deleteSecret } from "@/lib/db";
import type { AutomationSettings, WebhookTarget } from "@/lib/db/automation";
import { WebhookDialog } from "./webhook-dialog";

interface Props {
  settings: AutomationSettings;
  update: (patch: Partial<AutomationSettings>) => Promise<unknown>;
}

export function SettingsWebhooksSection({ settings, update }: Props) {
  const [editing, setEditing] = useState<WebhookTarget | null>(null);
  const [open, setOpen] = useState(false);
  const webhooks = settings.webhooks;

  const save = (webhook: WebhookTarget) =>
    update({
      webhooks: webhooks.some((entry) => entry.id === webhook.id)
        ? webhooks.map((entry) => (entry.id === webhook.id ? webhook : entry))
        : [...webhooks, webhook],
    });

  const remove = async (webhook: WebhookTarget) => {
    try {
      await update({ webhooks: webhooks.filter((entry) => entry.id !== webhook.id) });
    } catch {
      return;
    }
    await Promise.all([
      deleteSecret(`automation:webhook:${webhook.id}`).catch(() => undefined),
      deleteSecret(`automation:webhook:${webhook.id}:hmac`).catch(() => undefined),
    ]);
    toast.success(`„${webhook.name}“ entfernt`);
  };

  return (
    <section aria-labelledby="automation-settings-webhooks" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="automation-settings-webhooks" className="text-base font-semibold tracking-tight">
            Webhooks
          </h2>
          <p className="text-xs text-muted-foreground">
            Slack, Teams, Discord oder ein eigener Endpunkt.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon />
          Webhook hinzufügen
        </Button>
      </div>
      {webhooks.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-4 text-xs text-muted-foreground">
          Noch kein Webhook. Damit landen Fehler direkt im Team-Chat.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {webhooks.map((webhook) => (
            <li key={webhook.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <WebhookIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span title={webhook.name} className="truncate text-[13px] font-medium">
                  {webhook.name}
                </span>
                <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                  {WEBHOOK_KINDS.find((entry) => entry.value === webhook.kind)?.label ??
                    webhook.kind}
                  {webhook.sign && (
                    <>
                      <span aria-hidden>·</span>
                      <ShieldCheckIcon aria-hidden className="size-3" />
                      signiert
                    </>
                  )}
                </span>
              </div>
              <IconButton
                size="icon-sm"
                variant="ghost"
                aria-label={`„${webhook.name}“ bearbeiten`}
                onClick={() => {
                  setEditing(webhook);
                  setOpen(true);
                }}
              >
                <PencilIcon />
              </IconButton>
              <IconButton
                size="icon-sm"
                variant="ghost"
                aria-label={`„${webhook.name}“ entfernen`}
                className="hover:text-destructive"
                onClick={() => void remove(webhook)}
              >
                <Trash2Icon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <WebhookDialog open={open} webhook={editing} onOpenChange={setOpen} onSave={save} />
    </section>
  );
}
