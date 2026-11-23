import { invoke } from "./core";

export type DuckdbFilePathContext =
  | { state: "snapshot"; file_search_path: string | null; working_directory: string | null }
  | { state: "no_session" | "busy" | "unknown" };

export function readDuckdbFilePathContext(connectionString: string, database?: string) {
  return invoke<DuckdbFilePathContext>("read_duckdb_file_path_context", {
    connectionString,
    database,
  });
}
