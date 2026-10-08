import type { UpdateChannel } from "@/lib/settings";
import { invoke } from "./core";

export interface UpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
}

export function checkUpdate(
  channel: UpdateChannel,
  timeout: number,
): Promise<UpdateMetadata | null> {
  return invoke<UpdateMetadata | null>("check_update", { channel, timeout });
}
