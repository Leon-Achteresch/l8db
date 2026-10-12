import type { ObjectAdminType } from "@/lib/db";
import type { Tab } from "@/lib/table-tabs";

export function renameObjectTab(
  tab: Tab,
  schema: string,
  name: string,
  newName: string,
  type: ObjectAdminType,
): Tab {
  if (
    tab.kind === "table" &&
    tab.schema === schema &&
    tab.table === name &&
    (tab.entityType ?? "table") === (type === "table" ? "table" : "view")
  )
    return { ...tab, table: newName };
  if (type === "table" && tab.kind === "alter-table" && tab.schema === schema && tab.table === name)
    return { ...tab, table: newName };
  if (type === "view" && tab.kind === "view-editor" && tab.schema === schema && tab.view === name)
    return { ...tab, view: newName };
  return tab;
}

export function objectRenameIssue(name: string, next: string): string | null {
  if (!next.trim()) return "Neuen Namen eingeben.";
  if (next.trim() === name) return "Der Name ist unverändert.";
  if (next.includes('"') || next.includes("\0"))
    return "Der Name darf keine Anführungszeichen oder Nullzeichen enthalten.";
  return null;
}
