import { useMemo } from "react";
import { useActiveDatabase } from "@/lib/db-selection";
import { useQueryHistoryStore } from "@/lib/query-history";
import { RecentQueries } from "../connected-dashboard/recent-queries";

const RECENT_LIMIT = 20;

export function RecentWidget({ connectionId }: { connectionId: string }) {
  const database = useActiveDatabase();
  const history = useQueryHistoryStore((state) => state.entries);
  const recent = useMemo(() => {
    const entries: typeof history = [];
    for (const entry of history) {
      if (entry.connectionId === connectionId && entry.database === database) {
        entries.push(entry);
        if (entries.length === RECENT_LIMIT) break;
      }
    }
    return entries;
  }, [history, connectionId, database]);
  return <RecentQueries recent={recent} />;
}
