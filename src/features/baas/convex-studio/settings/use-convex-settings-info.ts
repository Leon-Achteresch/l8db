import { useQuery } from "@tanstack/react-query";
import { convexStudioSettingsInfo } from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";

export const convexSettingsKey = (deployment: ConvexStudioDeployment, part: string) => [
  "convex",
  deployment.profileId,
  "studio",
  deployment.projectId,
  deployment.deploymentName,
  "settings",
  part,
];

export const convexDashboardUrl = (deployment: ConvexStudioDeployment) =>
  deployment.selfHosted ? null : `https://dashboard.convex.dev/d/${deployment.deploymentName}`;

export function useConvexSettingsInfo(deployment: ConvexStudioDeployment) {
  return useQuery({
    queryKey: convexSettingsKey(deployment, "info"),
    queryFn: () => convexStudioSettingsInfo(deployment),
  });
}
