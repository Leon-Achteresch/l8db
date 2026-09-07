import { CommunityExtensionsSection } from "@/features/community-extensions/community-extensions-section";

export function SettingsExtensionsTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Erweiterungen</h2>
        <p className="text-xs text-muted-foreground">
          Community-Plugins, Treibererweiterungen und benutzerdefinierte Skripte verwalten.
        </p>
      </div>

      <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
        <CommunityExtensionsSection />
      </div>
    </div>
  );
}
