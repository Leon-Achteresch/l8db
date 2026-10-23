import { invoke } from "./core";

export interface TeamFile {
  path: string;
  exists: boolean;
  connections: unknown[];
}

export function teamConnections(): Promise<TeamFile> {
  return invoke<TeamFile>("team_connections");
}
