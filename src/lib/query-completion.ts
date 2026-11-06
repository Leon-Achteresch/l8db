import { toast } from "sonner";
import { notifyQueryCompletion } from "@/lib/db/query-notifications";
import { createQueryCompletion, type QueryCompletion } from "@/lib/query-notifications";
import { useQueryQolSettings } from "@/lib/query-qol-settings";

export function beginQueryCompletion() {
  const finish = createQueryCompletion(
    () => useQueryQolSettings.getState().notifications,
    () => document.visibilityState === "hidden" || !document.hasFocus(),
    notifyQueryCompletion,
  );
  return (outcome: QueryCompletion) => {
    void finish(outcome).catch(() =>
      toast.warning(
        "Desktop-Meldung konnte nicht angezeigt werden. Prüfe die Mitteilungseinstellungen für l8db.",
      ),
    );
  };
}
