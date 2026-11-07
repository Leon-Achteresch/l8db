import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/features/settings/settings-row";
import { initOrganization } from "@/lib/organization";
import { useOrganizationStore } from "@/lib/organization-state";

export function OrganizationPanel() {
  const { policy, error } = useOrganizationStore();
  if (!policy?.managed && !error) return null;
  const disabled = policy
    ? [
        !policy.allowAi && "KI",
        !policy.allowExtensions && "Erweiterungen",
        !policy.allowPersonalSync && "persönliche Synchronisation",
        !policy.allowMcp && "MCP",
      ].filter(Boolean)
    : [];
  return (
    <SettingsRow
      title="Unternehmensrichtlinie"
      featureId="settings.general.organization"
      description="Verbindliche Vorgaben deiner IT bleiben auch nach einem Zurücksetzen erhalten."
      stacked
    >
      <div className="space-y-2 text-xs">
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : (
          <>
            <p>{policy?.organization || "Dieser Arbeitsplatz wird von deiner IT verwaltet."}</p>
            <p className="break-all text-muted-foreground">{policy?.path}</p>
            {policy?.support && <p>Support: {policy.support}</p>}
            {disabled.length > 0 && <p>Durch die IT gesperrt: {disabled.join(", ")}</p>}
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void initOrganization().catch(() => undefined)}
        >
          Richtlinie neu laden
        </Button>
      </div>
    </SettingsRow>
  );
}
