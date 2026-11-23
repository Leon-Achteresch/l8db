import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useAiAccess } from "@/lib/ai/access";
import { AI_PROVIDERS } from "@/lib/ai/store";

const providerName = (key: string) => {
  const [id, host] = key.split("@");
  const name = AI_PROVIDERS.find((entry) => entry.id === id)?.name ?? id;
  return host ? `${name} · ${host}` : name;
};

export function AiAccessRow() {
  const enabled = useAiAccess((state) => state.enabled);
  const consent = useAiAccess((state) => state.consent);
  const setEnabled = useAiAccess((state) => state.setEnabled);
  const revoke = useAiAccess((state) => state.revoke);
  return (
    <>
      <SettingsRow settingId="ki" featureId="settings.general.ki">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="KI" />
      </SettingsRow>
      {consent.length > 0 && (
        <SettingsRow title="Freigegeben">
          <div className="flex flex-wrap justify-end gap-1.5">
            {consent.map((key) => (
              <Button
                key={key}
                type="button"
                size="xs"
                variant="secondary"
                aria-label={`${providerName(key)} widerrufen`}
                title="Widerrufen"
                onClick={() => revoke(key)}
              >
                {providerName(key)}
                <XIcon />
              </Button>
            ))}
          </div>
        </SettingsRow>
      )}
    </>
  );
}
