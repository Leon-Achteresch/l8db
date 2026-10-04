import { SendIcon } from "lucide-react";
import { useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import { type ChannelRef, testAutomationChannel, type WebhookKind } from "@/lib/db/automation";
import { ChipsInput } from "./chips-input";
import { FormRow } from "./form-row";
import { useStepForm } from "./step-form-context";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KINDS: { value: ChannelRef["type"]; label: string }[] = [
  { value: "native", label: "System" },
  { value: "email", label: "E-Mail" },
  { value: "webhook", label: "Webhook" },
];

const WEBHOOK_KIND: Record<WebhookKind, string> = {
  slack: "Slack",
  teams: "Teams",
  discord: "Discord",
  generic: "Webhook",
};

interface Props {
  value: ChannelRef;
  onChange: (value: ChannelRef) => void;
  fieldPrefix?: string;
}

export function ChannelFields({ value, onChange, fieldPrefix = "" }: Props) {
  const { settings, issues, stepId } = useStepForm();
  const [testing, setTesting] = useState(false);
  const find = (field: string) =>
    issues.find(
      (entry) => entry.stepId === stepId && entry.field === `${fieldPrefix}channel.${field}`,
    );
  const issue = (field: string) => {
    const found = find(field);
    return found?.severity === "error" ? found.message : null;
  };
  const hint = (field: string) => {
    const found = find(field);
    return found?.severity === "warning" ? found.message : null;
  };
  const profiles = settings?.smtpProfiles ?? [];
  const webhooks = settings?.webhooks ?? [];
  const openSettings = () => useAutomationStore.getState().setView("settings");

  const test = async () => {
    setTesting(true);
    try {
      await testAutomationChannel(value);
      toast.success("Testnachricht gesendet.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const setKind = (type: ChannelRef["type"]) => {
    if (type === value.type) return;
    if (type === "native") onChange({ type });
    if (type === "email") onChange({ type, profileId: profiles[0]?.id ?? "", to: [], cc: [] });
    if (type === "webhook") onChange({ type, webhookId: webhooks[0]?.id ?? "" });
  };

  const missing = (what: string) => (
    <p className="text-xs text-pretty text-muted-foreground">
      Noch kein {what} eingerichtet.{" "}
      <button
        type="button"
        onClick={openSettings}
        className="font-medium text-foreground underline underline-offset-3 hover:text-primary"
      >
        In den Einstellungen anlegen
      </button>
    </p>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <FormRow label="Kanal" bind={false} className="flex-1">
          <SegmentedControl label="Kanal" value={value.type} options={KINDS} onChange={setKind} />
        </FormRow>
        <Button type="button" variant="outline" onClick={() => void test()} disabled={testing}>
          {testing ? <Spinner className="size-4" /> : <SendIcon />}
          Testen
        </Button>
      </div>

      {value.type === "native" && (
        <p className="text-xs text-pretty text-muted-foreground">
          Erscheint als Mitteilung des Betriebssystems, auch wenn l8db im Hintergrund läuft.
        </p>
      )}

      {value.type === "email" && (
        <div className="flex flex-col gap-4">
          <FormRow
            label="SMTP-Profil"
            error={issue("profileId")}
            warning={hint("profileId")}
            bind={false}
          >
            {profiles.length ? (
              <Select
                value={value.profileId}
                onValueChange={(profileId) => onChange({ ...value, profileId })}
              >
                <SelectTrigger aria-label="SMTP-Profil" className="w-full rounded-lg">
                  <SelectValue placeholder="Profil wählen" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                      <span className="text-muted-foreground">{profile.from}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              missing("SMTP-Profil")
            )}
          </FormRow>
          <FormRow label="An" error={issue("to")} warning={hint("to")}>
            <ChipsInput
              value={value.to}
              itemLabel="Empfänger"
              placeholder="name@firma.de"
              validate={(entry) =>
                entry.includes("${") || EMAIL.test(entry)
                  ? null
                  : `„${entry}“ ist keine E-Mail-Adresse.`
              }
              onChange={(to) => onChange({ ...value, to })}
            />
          </FormRow>
          <FormRow label="Kopie (CC)">
            <ChipsInput
              value={value.cc}
              itemLabel="Empfänger"
              validate={(entry) =>
                entry.includes("${") || EMAIL.test(entry)
                  ? null
                  : `„${entry}“ ist keine E-Mail-Adresse.`
              }
              onChange={(cc) => onChange({ ...value, cc })}
            />
          </FormRow>
        </div>
      )}

      {value.type === "webhook" && (
        <FormRow label="Ziel" error={issue("webhookId")} warning={hint("webhookId")} bind={false}>
          {webhooks.length ? (
            <Select
              value={value.webhookId}
              onValueChange={(webhookId) => onChange({ ...value, webhookId })}
            >
              <SelectTrigger aria-label="Webhook" className="w-full rounded-lg">
                <SelectValue placeholder="Webhook wählen" />
              </SelectTrigger>
              <SelectContent>
                {webhooks.map((hook) => (
                  <SelectItem key={hook.id} value={hook.id}>
                    {hook.name}
                    <span className="text-muted-foreground">{WEBHOOK_KIND[hook.kind]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            missing("Webhook")
          )}
        </FormRow>
      )}
    </div>
  );
}
