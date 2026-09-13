import { toast } from "sonner";
import { configureExecutionDefaults } from "@/lib/db";
import { useSettingsStore } from "@/lib/settings";

export function initExecutionSettings() {
  let pending = Promise.resolve();
  const sync = () => {
    const { queryTimeout, connectionTimeout } = useSettingsStore.getState();
    pending = pending
      .then(() => configureExecutionDefaults(queryTimeout, connectionTimeout))
      .catch((error) => {
        toast.error(`Zeitgrenzen konnten nicht übernommen werden: ${String(error)}`);
      });
    return pending;
  };
  const dispose = useSettingsStore.subscribe((current, previous) => {
    if (
      current.queryTimeout !== previous.queryTimeout ||
      current.connectionTimeout !== previous.connectionTimeout
    )
      void sync();
  });
  return { ready: sync(), dispose };
}
