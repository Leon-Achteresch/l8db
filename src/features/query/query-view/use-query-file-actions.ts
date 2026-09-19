import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { openSqlFileAsTab, useQueryFile } from "@/lib/hooks/use-query-file";

export function useQueryFileActions(tabId: string, filePath: string | null) {
  const navigate = useNavigate();
  const { saveToFile, reloadFromFile, keepLocal, checkExternal } = useQueryFile(tabId);
  const [fileBusy, setFileBusy] = useState(false);

  useEffect(() => {
    if (!filePath) return;
    void checkExternal();
    const onFocus = () => void checkExternal();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [filePath, checkExternal]);

  const handleFileSave = useCallback(
    async (saveAs: boolean) => {
      if (fileBusy) return;
      setFileBusy(true);
      try {
        await saveToFile(saveAs);
      } finally {
        setFileBusy(false);
      }
    },
    [fileBusy, saveToFile],
  );

  const handleFileOpen = useCallback(async () => {
    if (fileBusy) return;
    setFileBusy(true);
    try {
      const id = await openSqlFileAsTab();
      if (id) void navigate({ to: "/query/$id", params: { id } });
    } finally {
      setFileBusy(false);
    }
  }, [fileBusy, navigate]);

  return { fileBusy, handleFileSave, handleFileOpen, reloadFromFile, keepLocal };
}
