import { toast } from "sonner";
import { configureExecutionDefaults } from "@/lib/db";
import { useSettingsStore } from "@/lib/settings";

export function initExecutionSettings() {
  let pending = Promise.resolve();
  const sync = () => {
    const { queryTimeout, connectionTimeout, oraclePlsqlWarnings } = useSettingsStore.getState();
    pending = pending
      .then(() => configureExecutionDefaults(queryTimeout, connectionTimeout, oraclePlsqlWarnings))
      .catch((error) => {
        toast.error(`Zeitgrenzen konnten nicht übernommen werden: ${String(error)}`);
      });
    return pending;
  };
  const dispose = useSettingsStore.subscribe((current, previous) => {
    if (
      current.queryTimeout !== previous.queryTimeout ||
      current.connectionTimeout !== previous.connectionTimeout ||
      current.oraclePlsqlWarnings !== previous.oraclePlsqlWarnings
    )
      void sync();
  });
  return { ready: sync(), dispose };
}
