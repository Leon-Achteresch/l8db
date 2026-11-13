import { invoke } from "./core";
import type { OrganizationPolicy } from "./organization";

export interface TeamFile {
  warnings?: string[];
  path: string;
  exists: boolean;
  connections: unknown[];
  tips?: unknown[];
  organization?: OrganizationPolicy;
}

export function teamConnections(): Promise<TeamFile> {
  return invoke<TeamFile>("team_connections");
}
