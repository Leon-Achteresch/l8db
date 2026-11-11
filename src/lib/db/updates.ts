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
  version?: string,
): Promise<UpdateMetadata | null> {
  return invoke<UpdateMetadata | null>("check_update", {
    channel,
    timeout,
    ...(version ? { version } : {}),
  });
}

export interface UpdateReleasePage {
  versions: string[];
  nextPage: number | null;
}

export async function listUpdateReleases(
  channel: UpdateChannel,
  page: number,
  signal?: AbortSignal,
): Promise<UpdateReleasePage> {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void invoke("cancel_update_release_request", { requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await invoke<UpdateReleasePage>("list_update_releases", { channel, page, requestId });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
