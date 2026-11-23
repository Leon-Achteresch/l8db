import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { openSqlFileAsTab, useQueryFile } from "@/lib/hooks/use-query-file";
import type { SqlFileReadEncoding } from "@/lib/sql-file";

export type QueryFileEncodingAction = "open" | "reload";

export function useQueryFileActions(tabId: string, filePath: string | null) {
  const navigate = useNavigate();
  const { saveToFile, reloadFromFile: readAgain, keepLocal, checkExternal } = useQueryFile(tabId);
  const [fileBusy, setFileBusy] = useState(false);
  const busy = useRef(false);
  const [encodingAction, setEncodingAction] = useState<QueryFileEncodingAction | null>(null);

  useEffect(() => {
    if (!filePath) return;
    void checkExternal();
    const onFocus = () => void checkExternal();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [filePath, checkExternal]);

  const runFileAction = useCallback(async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setFileBusy(true);
    try {
      await action();
    } finally {
      busy.current = false;
      setFileBusy(false);
    }
  }, []);

  const handleFileSave = useCallback(
    (saveAs: boolean) => runFileAction(() => saveToFile(saveAs)),
    [runFileAction, saveToFile],
  );
  const handleFileOpen = useCallback(
    (encoding?: SqlFileReadEncoding) =>
      runFileAction(async () => {
        const id = await openSqlFileAsTab(encoding);
        if (id) void navigate({ to: "/query/$id", params: { id } });
      }),
    [navigate, runFileAction],
  );
  const reloadFromFile = useCallback(
    (encoding?: SqlFileReadEncoding) => runFileAction(() => readAgain(encoding)),
    [readAgain, runFileAction],
  );
  const applyEncoding = (encoding: SqlFileReadEncoding) => {
    setEncodingAction(null);
    if (encodingAction === "reload") void reloadFromFile(encoding);
    if (encodingAction === "open") void handleFileOpen(encoding);
  };

  return {
    fileBusy,
    handleFileSave,
    handleFileOpen,
    reloadFromFile,
    keepLocal,
    encodingAction,
    setEncodingAction,
    applyEncoding,
  };
}
