import { useMemo } from "react";
import { useActiveDatabase } from "@/lib/db-selection";
import { useQueryHistoryStore } from "@/lib/query-history";
import { selectActivity } from "../activity";
import { RecentQueries } from "../connected-dashboard/recent-queries";

export function RecentWidget({ connectionId }: { connectionId: string }) {
  const database = useActiveDatabase();
  const history = useQueryHistoryStore((state) => state.entries);
  const activity = useMemo(
    () => selectActivity(history, connectionId, database, Date.now()),
    [history, connectionId, database],
  );
  return <RecentQueries recent={activity.recent} activity={activity} />;
}
