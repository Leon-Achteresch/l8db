import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  defaultSqlFileName,
  fileMtimeChanged,
  sqlFileSizeError,
  sqlFileTitle,
} from "@/lib/sql-file";
import { type QueryTab, useTableTabs } from "@/lib/table-tabs";

const SQL_FILTERS = [{ name: "SQL", extensions: ["sql", "txt"] }];

async function readFileMeta(path: string): Promise<{ mtime: number | null; size: number | null }> {
  try {
    const info = await stat(path);
    return { mtime: info.mtime ? info.mtime.getTime() : null, size: info.size };
  } catch {
    return { mtime: null, size: null };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findQueryTab(id: string): QueryTab | null {
  const tab = useTableTabs.getState().tabs.find((t) => t.kind === "query" && t.id === id);
  return tab && tab.kind === "query" ? tab : null;
}

export async function openSqlFileAsTab(): Promise<string | null> {
  const path = await open({ multiple: false, directory: false, filters: SQL_FILTERS });
  if (!path) return null;
  try {
    const meta = await readFileMeta(path);
    const sizeError = sqlFileSizeError(meta.size);
    if (sizeError) throw new Error(sizeError);
    const sql = await readTextFile(path);
    return useTableTabs.getState().openFileQueryTab({
      path,
      sql,
      title: sqlFileTitle(path),
      mtime: meta.mtime,
    });
  } catch (error) {
    toast.error(`Datei konnte nicht geöffnet werden: ${errorMessage(error)}`);
    return null;
  }
}

export async function detectExternalChange(tabId: string): Promise<boolean> {
  const tab = findQueryTab(tabId);
  if (!tab?.filePath) return false;
  const meta = await readFileMeta(tab.filePath);
  const changed = fileMtimeChanged(tab.fileMtime, meta.mtime);
  if (changed && !tab.externalChange) {
    useTableTabs.getState().setQueryTabExternalChange(tabId, true);
  }
  return changed || Boolean(tab.externalChange);
}

export function useQueryFile(tabId: string) {
  const saveToFile = useCallback(
    async (saveAs: boolean): Promise<boolean> => {
      const tab = findQueryTab(tabId);
      if (!tab) return false;
      if (!saveAs && tab.filePath) {
        const changed = await detectExternalChange(tabId);
        if (changed) {
          toast.warning("Datei wurde extern geändert. Bitte zuerst neu laden oder lokale Fassung behalten.");
          return false;
        }
      }
      let path = tab.filePath;
      if (saveAs || !path) {
        const picked = await save({
          defaultPath: tab.filePath ?? defaultSqlFileName(tab.title),
          filters: SQL_FILTERS,
        });
        if (!picked) return false;
        path = picked;
      }
      try {
        await writeTextFile(path, tab.sql);
      } catch (error) {
        toast.error(`Datei konnte nicht gespeichert werden: ${errorMessage(error)}`);
        return false;
      }
      const meta = await readFileMeta(path);
      const store = useTableTabs.getState();
      if (path !== tab.filePath) {
        store.bindQueryTabFile(tabId, { path, title: sqlFileTitle(path), mtime: meta.mtime });
      } else {
        store.markQueryTabSaved(tabId, meta.mtime);
      }
      return true;
    },
    [tabId],
  );

  const reloadFromFile = useCallback(async (): Promise<boolean> => {
    const tab = findQueryTab(tabId);
    if (!tab?.filePath) return false;
    try {
      const sql = await readTextFile(tab.filePath);
      const meta = await readFileMeta(tab.filePath);
      useTableTabs.getState().reloadQueryTabFromFile(tabId, sql, meta.mtime);
      return true;
    } catch (error) {
      toast.error(`Datei konnte nicht neu geladen werden: ${errorMessage(error)}`);
      return false;
    }
  }, [tabId]);

  const keepLocal = useCallback(async () => {
    const tab = findQueryTab(tabId);
    if (!tab?.filePath) return;
    const meta = await readFileMeta(tab.filePath);
    useTableTabs.getState().setQueryTabExternalChange(tabId, false, meta.mtime);
  }, [tabId]);

  const checkExternal = useCallback(() => detectExternalChange(tabId), [tabId]);

  return { saveToFile, reloadFromFile, keepLocal, checkExternal };
}
