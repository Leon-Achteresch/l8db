import { invoke } from "./core";

export function sqlSearchPath(): Promise<string[]> {
  return invoke<string[]>("sql_search_path");
}
