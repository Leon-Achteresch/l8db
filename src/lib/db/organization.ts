import { invoke } from "./core";

export interface OrganizationPolicy {
  path: string;
  managed: boolean;
  organization: string;
  support: string;
  settings: Record<string, unknown>;
  allowAi: boolean;
  allowExtensions: boolean;
  allowPersonalSync: boolean;
  allowMcp: boolean;
  connections?: unknown[];
}

export function loadOrganizationPolicy(): Promise<OrganizationPolicy> {
  return invoke("organization_policy");
}
