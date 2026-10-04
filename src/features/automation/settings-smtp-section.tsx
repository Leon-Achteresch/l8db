import { MailIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/automation/toast";
import { deleteSecret } from "@/lib/db";
import type { AutomationSettings, SmtpProfile } from "@/lib/db/automation";
import { SmtpProfileDialog } from "./smtp-profile-dialog";

interface Props {
  settings: AutomationSettings;
  update: (patch: Partial<AutomationSettings>) => Promise<unknown>;
}

const SECURITY = { starttls: "STARTTLS", tls: "TLS", none: "unverschlüsselt" } as const;

export function SettingsSmtpSection({ settings, update }: Props) {
  const [editing, setEditing] = useState<SmtpProfile | null>(null);
  const [open, setOpen] = useState(false);
  const profiles = settings.smtpProfiles;

  const save = (profile: SmtpProfile) =>
    update({
      smtpProfiles: profiles.some((entry) => entry.id === profile.id)
        ? profiles.map((entry) => (entry.id === profile.id ? profile : entry))
        : [...profiles, profile],
    });

  const remove = async (profile: SmtpProfile) => {
    try {
      await update({ smtpProfiles: profiles.filter((entry) => entry.id !== profile.id) });
    } catch {
      return;
    }
    await deleteSecret(`automation:smtp:${profile.id}`).catch(() => undefined);
    toast.success(`„${profile.name}“ entfernt`, {
      description: "Benachrichtigungen mit diesem Profil schlagen fehl, bis du ein anderes wählst.",
    });
  };

  return (
    <section aria-labelledby="automation-settings-smtp" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="automation-settings-smtp" className="text-base font-semibold tracking-tight">
            E-Mail (SMTP)
          </h2>
          <p className="text-xs text-muted-foreground">
            Postausgangsserver für Benachrichtigungen per E-Mail.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          data-testid="automation-smtp-add"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <PlusIcon />
          Profil hinzufügen
        </Button>
      </div>
      {profiles.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-4 text-xs text-muted-foreground">
          Noch kein Profil. Lege eines an, um Berichte und Fehler per E-Mail zu verschicken.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {profiles.map((profile) => (
            <li key={profile.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <MailIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span title={profile.name} className="truncate text-[13px] font-medium">
                  {profile.name}
                </span>
                <span
                  title={`${profile.from} · ${profile.host}:${profile.port}`}
                  className="truncate text-[11px] text-muted-foreground"
                >
                  {profile.from} · {profile.host}:{profile.port} · {SECURITY[profile.security]}
                </span>
              </div>
              <IconButton
                size="icon-sm"
                variant="ghost"
                aria-label={`„${profile.name}“ bearbeiten`}
                onClick={() => {
                  setEditing(profile);
                  setOpen(true);
                }}
              >
                <PencilIcon />
              </IconButton>
              <IconButton
                size="icon-sm"
                variant="ghost"
                aria-label={`„${profile.name}“ entfernen`}
                className="hover:text-destructive"
                onClick={() => void remove(profile)}
              >
                <Trash2Icon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <SmtpProfileDialog open={open} profile={editing} onOpenChange={setOpen} onSave={save} />
    </section>
  );
}
