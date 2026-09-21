import type { RepositoryRequest } from "@/lib/versioning/types";
import { invoke } from "./core";

export function versioningRepository<T>(request: RepositoryRequest): Promise<T> {
  return invoke("versioning_repository", { request });
}

export function versioningOracleTimeout(txId: string, milliseconds: number): Promise<void> {
  return invoke("versioning_oracle_timeout", { txId, milliseconds });
}
