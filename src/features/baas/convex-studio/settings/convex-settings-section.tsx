import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { ConvexSettingsAuth } from "./convex-settings-auth";
import { ConvexSettingsDanger } from "./convex-settings-danger";
import { ConvexSettingsExport } from "./convex-settings-export";
import { ConvexSettingsImport } from "./convex-settings-import";
import { ConvexSettingsInfo } from "./convex-settings-info";

export function ConvexSettingsSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.convex.studio.settings");

  return (
    <div className="space-y-6">
      <div ref={feature.ref} className="flex items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Einstellungen</h2>
        {feature.isNew && <NewBadge />}
      </div>
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
