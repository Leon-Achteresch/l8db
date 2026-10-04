import { BellIcon, BellRingIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { newNotification } from "@/lib/automation/defaults";
import { NOTIFY_WHEN_LABELS } from "@/lib/automation/labels";
import { toast } from "@/lib/automation/toast";
import type { NotificationRule, NotifyWhen, Task } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { ChannelFields } from "./channel-fields";
import { FormRow } from "./form-row";
import { SwitchRow } from "./switch-row";
import { TemplateInput } from "./template-input";

interface Props {
  task: Task;
  onChange: (notifications: NotificationRule[]) => void;
}

const WHEN = Object.entries(NOTIFY_WHEN_LABELS) as [NotifyWhen, string][];

const TITLE_HINT: Record<NotifyWhen, string> = {
  failure: "${task} ist fehlgeschlagen",
  success: "${task} war erfolgreich",
  warning: "${task}: Warnungen",
  always: "${task}: ${run.status}",
  alert_triggered: "Alarm in ${task}: ${alert.value}",
  alert_resolved: "Entwarnung in ${task}",
};

export function NotificationsTab({ task, onChange }: Props) {
  const rules = task.notifications;
  const update = (rule: NotificationRule) =>
    onChange(rules.map((entry) => (entry.id === rule.id ? rule : entry)));
  const add = () => onChange([...rules, newNotification()]);
  const remove = (id: string) => {
    onChange(rules.filter((entry) => entry.id !== id));
    toast("Regel entfernt", { action: { label: "Rückgängig", onClick: () => onChange(rules) } });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 pt-5 pb-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold tracking-tight">Benachrichtigungen</h3>
          <p className="max-w-prose text-xs text-pretty text-muted-foreground">
            Wer nach einem Lauf Bescheid bekommt. Leerer Titel oder Text nutzt eine passende
            Standardmeldung.
          </p>
        </div>
        {rules.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PlusIcon />
            Regel
          </Button>
        )}
      </header>

      {rules.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
            <BellIcon className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Keine Benachrichtigungen</p>
            <p className="max-w-prose text-xs text-pretty text-muted-foreground">
              Fehlgeschlagene Läufe siehst du trotzdem im Verlauf. Eine Regel „Bei Fehler“ sorgt
              dafür, dass du es auch merkst, wenn die App im Hintergrund läuft.
            </p>
          </div>
          <Button type="button" size="sm" onClick={add}>
            <BellRingIcon />
            Bei Fehler benachrichtigen
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className={cn(
                "flex flex-col gap-4 rounded-xl border bg-card p-4 transition-opacity duration-200",
                !rule.enabled && "opacity-60",
              )}
            >
              <div className="flex items-center gap-3">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => update({ ...rule, enabled })}
                  aria-label={rule.enabled ? "Regel pausieren" : "Regel aktivieren"}
                />
                <Select
                  value={rule.when}
                  onValueChange={(when) => update({ ...rule, when: when as NotifyWhen })}
                >
                  <SelectTrigger
                    aria-label="Wann"
                    className="h-8 w-56 rounded-lg text-[13px] font-medium"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WHEN.map(([when, label]) => (
                      <SelectItem key={when} value={when}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Regel entfernen"
                  onClick={() => remove(rule.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon />
                </Button>
              </div>
              <ChannelFields
                value={rule.channel}
                onChange={(channel) => update({ ...rule, channel })}
                fieldPrefix={`notifications.${rule.id}.`}
              />
              <FormRow label="Titel">
                <TemplateInput
                  value={rule.title}
                  placeholder={TITLE_HINT[rule.when]}
                  onChange={(title) => update({ ...rule, title })}
                />
              </FormRow>
              <FormRow
                label="Text"
                hint="Platzhalter wie ${run.summary} oder ${run.error} mit ${ einfügen."
              >
                <TemplateInput
                  multiline
                  rows={3}
                  value={rule.body}
                  placeholder="${run.summary}"
                  onChange={(body) => update({ ...rule, body })}
                />
              </FormRow>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                {rule.channel.type !== "native" && (
                  <SwitchRow
                    label="Ausgabedateien anhängen"
                    description={
                      rule.channel.type === "webhook"
                        ? "Als Liste der Pfade."
                        : "Bis 20 MiB insgesamt, darüber nur die Pfade."
                    }
                    checked={rule.attachOutputs}
                    onCheckedChange={(attachOutputs) => update({ ...rule, attachOutputs })}
                  />
                )}
                <SwitchRow
                  label="Nicht senden, wenn leer"
                  description="Wenn der Lauf keine Zeilen und keine Dateien erzeugt hat."
                  checked={rule.skipIfEmpty}
                  onCheckedChange={(skipIfEmpty) => update({ ...rule, skipIfEmpty })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
