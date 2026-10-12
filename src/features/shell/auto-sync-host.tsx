import { useAutoSync } from "@/lib/sync/use-auto-sync";

export function AutoSyncHost() {
  useAutoSync();
  return null;
}
