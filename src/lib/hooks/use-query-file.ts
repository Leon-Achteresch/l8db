import { open, save } from "@tauri-apps/plugin-dialog";
import { stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  defaultSqlFileName,
  fileMtimeChanged,
  isSqlFileReadEncoding,
  readSqlFile,
  type SqlFileReadEncoding,
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

function sameFileBinding(tab: QueryTab, current: QueryTab | null): current is QueryTab {
  return Boolean(
    current &&
      tab.filePath === current.filePath &&
      tab.fileReadEncoding === current.fileReadEncoding &&
      tab.fileRequiresUtf8Copy === current.fileRequiresUtf8Copy,
  );
}

async function loadSqlFile(path: string, encoding: SqlFileReadEncoding) {
  const meta = await readFileMeta(path);
  const sizeError = sqlFileSizeError(meta.size);
  if (sizeError) throw new Error(sizeError);
  const { text, requiresUtf8Copy } = await readSqlFile(path, encoding);
  return { sql: text, mtime: meta.mtime, read: { encoding, requiresUtf8Copy } };
}

export async function openSqlPathAsTab(
  path: string,
  encoding: SqlFileReadEncoding = "auto",
): Promise<string | null> {
  try {
    const existing = useTableTabs
      .getState()
      .tabs.find((tab) => tab.kind === "query" && tab.filePath === path);
    if (existing?.kind === "query") {
      if (encoding !== "auto" && encoding !== existing.fileReadEncoding)
        toast.info("Datei ist bereits geöffnet. Wähle die Lesekodierung im vorhandenen Tab.");
      return existing.id;
    }
    const file = await loadSqlFile(path, encoding);
    return useTableTabs.getState().openFileQueryTab({
      ...file,
      path,
      title: sqlFileTitle(path),
    });
  } catch (error) {
    toast.error(`Datei konnte nicht geöffnet werden: ${errorMessage(error)}`);
    return null;
  }
}

export async function openSqlFileAsTab(
  encoding: SqlFileReadEncoding = "auto",
): Promise<string | null> {
  try {
    const path = await open({ multiple: false, directory: false, filters: SQL_FILTERS });
    return path ? openSqlPathAsTab(path, encoding) : null;
  } catch (error) {
    toast.error(`Datei konnte nicht geöffnet werden: ${errorMessage(error)}`);
    return null;
  }
}

export async function detectExternalChange(tabId: string): Promise<boolean> {
  const tab = findQueryTab(tabId);
  if (!tab?.filePath) return false;
  const meta = await readFileMeta(tab.filePath);
  const current = findQueryTab(tabId);
  if (!sameFileBinding(tab, current) || current.fileMtime !== tab.fileMtime) return false;
  const changed = fileMtimeChanged(current.fileMtime, meta.mtime);
  if (changed && !current.externalChange) {
    useTableTabs.getState().setQueryTabExternalChange(tabId, true);
  }
  return changed || Boolean(current.externalChange);
}

export async function saveQueryTabFile(tabId: string, saveAs = false): Promise<boolean> {
  try {
    const tab = findQueryTab(tabId);
    if (!tab) return false;
    const copy = !!tab.filePath && !!tab.fileRequiresUtf8Copy;
    if (!copy && !saveAs && tab.filePath && (await detectExternalChange(tabId))) {
      toast.warning(
        "Datei wurde extern geändert. Bitte zuerst neu laden oder lokale Fassung behalten.",
      );
      return false;
    }

    let path = tab.filePath;
    if (copy || saveAs || !path) {
      const picked = await save({
        ...(copy && { title: "UTF-8-Kopie speichern" }),
        defaultPath:
          copy && path
            ? `${path.replace(/\.(sql|txt)$/i, "")}-utf8.sql`
            : (path ?? defaultSqlFileName(tab.title)),
        filters: SQL_FILTERS,
      });
      if (!picked) return false;
      if (copy && picked === path) {
        toast.error("Wähle einen neuen Dateinamen für die UTF-8-Kopie.");
        return false;
      }
      path = picked;
    }
    const current = findQueryTab(tabId);
    if (
      !sameFileBinding(tab, current) ||
      current.fileMtime !== tab.fileMtime ||
      current.savedSql !== tab.savedSql
    )
      return false;
    await writeTextFile(path, tab.sql, copy ? { createNew: true } : undefined);
    const meta = await readFileMeta(path);
    if (!sameFileBinding(tab, findQueryTab(tabId))) return false;
    const store = useTableTabs.getState();
    if (path !== tab.filePath) {
      store.bindQueryTabFile(tabId, {
        path,
        title: sqlFileTitle(path),
        mtime: meta.mtime,
        savedSql: tab.sql,
      });
    } else {
      store.markQueryTabSaved(tabId, meta.mtime, tab.sql);
    }
    return true;
  } catch (error) {
    toast.error(`Datei konnte nicht gespeichert werden: ${errorMessage(error)}`);
    return false;
  }
}

export async function reloadQueryTabFile(
  tabId: string,
  encoding?: SqlFileReadEncoding,
): Promise<boolean> {
  const tab = findQueryTab(tabId);
  if (!tab?.filePath) return false;
  const chosen =
    encoding ?? (isSqlFileReadEncoding(tab.fileReadEncoding) ? tab.fileReadEncoding : "auto");
  try {
    const file = await loadSqlFile(tab.filePath, chosen);
    const current = findQueryTab(tabId);
    if (
      !sameFileBinding(tab, current) ||
      current.sql !== tab.sql ||
      current.savedSql !== tab.savedSql ||
      current.fileMtime !== tab.fileMtime
    ) {
      toast.warning("Der Tab wurde während des Neuladens geändert. Bitte erneut versuchen.");
      return false;
    }
    useTableTabs.getState().reloadQueryTabFromFile(tabId, file.sql, file.mtime, file.read);
    return true;
  } catch (error) {
    toast.error(`Datei konnte nicht neu geladen werden: ${errorMessage(error)}`);
    return false;
  }
}

export function useQueryFile(tabId: string) {
  const saveToFile = useCallback((saveAs: boolean) => saveQueryTabFile(tabId, saveAs), [tabId]);

  const reloadFromFile = useCallback(
    (encoding?: SqlFileReadEncoding) => reloadQueryTabFile(tabId, encoding),
    [tabId],
  );

  const keepLocal = useCallback(async () => {
    const tab = findQueryTab(tabId);
    if (!tab?.filePath) return;
    const meta = await readFileMeta(tab.filePath);
    const current = findQueryTab(tabId);
    if (sameFileBinding(tab, current) && current.fileMtime === tab.fileMtime)
      useTableTabs.getState().setQueryTabExternalChange(tabId, false, meta.mtime);
  }, [tabId]);

  const checkExternal = useCallback(() => detectExternalChange(tabId), [tabId]);

  return { saveToFile, reloadFromFile, keepLocal, checkExternal };
}
