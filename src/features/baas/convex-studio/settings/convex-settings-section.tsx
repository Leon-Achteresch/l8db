import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasSectionHeader } from "../../baas-section-header";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { ConvexSettingsAuth } from "./convex-settings-auth";
import { ConvexSettingsDanger } from "./convex-settings-danger";
import { ConvexSettingsExport } from "./convex-settings-export";
import { ConvexSettingsImport } from "./convex-settings-import";
import { ConvexSettingsInfo } from "./convex-settings-info";

export function ConvexSettingsSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.convex.studio.settings");

  return (
    <div className="space-y-6">
      <BaasSectionHeader
        title="Einstellungen"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Deployment-Infos, Authentifizierung, Export, Import und Gefahrenzone."
      />
      <ConvexSettingsInfo deployment={deployment} />
      <ConvexSettingsAuth deployment={deployment} />
      <div className="grid gap-6 xl:grid-cols-2">
        <ConvexSettingsExport deployment={deployment} />
        <ConvexSettingsImport deployment={deployment} />
      </div>
      <ConvexSettingsDanger deployment={deployment} />
    </div>
  );
}
