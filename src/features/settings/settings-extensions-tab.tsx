import { CommunityExtensionsSection } from "@/features/community-extensions/community-extensions-section";
import { ExtensionMarketSection } from "@/features/community-extensions/extension-market-section";

export function SettingsExtensionsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Erweiterungen</h2>
        <p className="text-xs text-muted-foreground">
          Erweiterungen installieren, freigeben und einrichten.
        </p>
      </div>
      <CommunityExtensionsSection />
      <ExtensionMarketSection />
    </div>
  );
}
