import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

export type OpenFileAction =
  | { action: "connection"; kind: DatabaseKind; path: string; name: string }
  | { action: "sql"; path: string }
  | { action: "notebook"; path: string }
  | { action: "unsupported"; path: string };

export const OPEN_FILES_EVENT = "open-files";

export function takePendingOpenFiles(): Promise<OpenFileAction[]> {
  return invoke<OpenFileAction[]>("take_pending_open_files");
}

export function resolveOpenFiles(paths: string[]): Promise<OpenFileAction[]> {
  return invoke<OpenFileAction[]>("resolve_open_files", { paths });
}
