import { useCallback } from "react";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { objectDraftKey, useObjectDrafts } from "@/lib/object-drafts";

export function useObjectDraft(objectKey: string, title: string, source: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const key = objectDraftKey(connection?.id ?? "", database, objectKey);
  const draft = useObjectDrafts((state) => state.drafts[key]);
  const setDraft = useCallback(
    (sql: string | null) => {
      const store = useObjectDrafts.getState();
      if (sql === null) store.remove(key);
      else if (connection)
        store.put({
          key,
          connectionId: connection.id,
          database,
          title,
          objectKey,
          sql,
          base: store.drafts[key]?.base ?? source,
        });
    },
    [connection, database, key, objectKey, source, title],
  );
  const clearSavedDraft = useCallback(
    (savedSql: string) => {
      const store = useObjectDrafts.getState();
      if (store.drafts[key]?.sql === savedSql) store.remove(key);
    },
    [key],
  );
  return [draft?.sql ?? null, setDraft, clearSavedDraft] as const;
}
