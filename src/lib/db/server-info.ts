import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

export interface ServerInfo {
  version: string;
  major: number;
  minor: number;
  version_full: string | null;
  container: string | null;
  cdb: string | null;
  database: string | null;
  service: string | null;
  instance: string | null;
  sid: string | null;
  edition: string | null;
  user: string;
  max_identifier: number;
  privileges: string[];
  views: string[];
  dbms_transaction: boolean;
  limits: string[];
}

export async function getServerInfo(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<ServerInfo> {
  return invoke("server_info", { kind, connectionString, database });
}
