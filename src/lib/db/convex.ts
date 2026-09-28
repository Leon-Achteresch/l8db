import { invoke } from "./core";

export interface ConvexProfile {
  id: string;
  team_id: number;
}

export interface ConvexProject {
  id: number;
  name: string;
  slug: string;
  teamSlug: string;
  prodDeploymentName: string | null;
  devDeploymentName: string | null;
}

export interface ConvexProjects {
  items: ConvexProject[];
  pagination: { hasMore: boolean; nextCursor: string | null };
}

export interface ConvexDeployment {
  name: string;
  deploymentType: string;
  reference: string | null;
  region: string | null;
  deploymentUrl: string | null;
  kind: string;
  isDefault: boolean | null;
}

export const convexConnect = (teamId: number, token: string) =>
  invoke<ConvexProfile>("convex_connect", { teamId, token });
export const convexProfiles = () => invoke<ConvexProfile[]>("convex_profiles");
export const convexDisconnect = (id: string) => invoke<void>("convex_disconnect", { id });
export const convexProjects = (id: string, cursor?: string) =>
  invoke<ConvexProjects>("convex_projects", { id, cursor: cursor ?? null });
export const convexDeployments = (id: string, projectId: number) =>
  invoke<ConvexDeployment[]>("convex_deployments", { id, projectId });
export const convexEnvironmentVariables = (id: string, projectId: number, deploymentName: string) =>
  invoke<string[]>("convex_environment_variables", { id, projectId, deploymentName });
export const convexSetEnvironmentVariable = (
  id: string,
  projectId: number,
  deploymentName: string,
  name: string,
  value: string,
) =>
  invoke<void>("convex_set_environment_variable", { id, projectId, deploymentName, name, value });
export const convexDeleteEnvironmentVariable = (
  id: string,
  projectId: number,
  deploymentName: string,
  name: string,
) => invoke<void>("convex_delete_environment_variable", { id, projectId, deploymentName, name });
