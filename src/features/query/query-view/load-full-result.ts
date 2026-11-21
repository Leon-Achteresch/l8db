import { toast } from "sonner";
import { cancelExecution, type QueryResult } from "@/lib/db";

export type FullResultLoader = (onJob: (id: string) => void) => Promise<QueryResult>;

export async function loadFullResult(load: FullResultLoader): Promise<QueryResult | null> {
  let job: string | null = null;
  let cancelled = false;
  const cancel = () => {
    if (job) void cancelExecution(job).catch(() => undefined);
  };
  const id = toast.loading("Alle Zeilen werden geladen…", {
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: "Abbrechen",
      onClick: () => {
        cancelled = true;
        cancel();
      },
    },
  });
  try {
    const result = await load((next) => {
      job = next;
      if (cancelled) cancel();
    });
    if (cancelled) {
      toast.info("Export abgebrochen", { id, duration: 4000 });
      return null;
    }
    toast.success(`${result.rows.length.toLocaleString("de-DE")} Zeilen geladen`, {
      id,
      duration: 4000,
    });
    return result;
  } catch (error) {
    if (cancelled) toast.info("Export abgebrochen", { id, duration: 4000 });
    else toast.error(`Laden fehlgeschlagen: ${String(error)}`, { id, duration: 4000 });
    return null;
  }
}
