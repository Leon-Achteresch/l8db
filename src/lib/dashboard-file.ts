import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Dashboard } from "@/lib/dashboards";

export type DashboardFile = Omit<
  Dashboard,
  "id" | "connectionId" | "database" | "createdAt" | "filePath" | "fileStamp"
>;

export function parseDashboard(text: string): DashboardFile {
  const parsed = JSON.parse(text) as DashboardFile;
  if (!Array.isArray(parsed.widgets) || !Array.isArray(parsed.datasets))
    throw new Error("Ungültiges Dashboard-Format");
  return parsed;
}

export function confirmExpertSql(dashboard: DashboardFile): boolean {
  const queries = dashboard.datasets
    .filter((d) => d.mode === "expert" && d.sql?.trim())
    .map((d) => `${d.name}:\n${d.sql.trim()}`);
  if (!queries.length) return true;
  return window.confirm(
    `Das Dashboard enthält ${queries.length} SQL-Abfrage(n), die direkt auf der Datenbank ausgeführt werden:\n\n${queries.join("\n\n")}\n\nFortfahren?`,
  );
}

export function serializeDashboard(dashboard: Dashboard): string {
  const { name, datasets, widgets, refreshSec, locked } = dashboard;
  return `${JSON.stringify({ name, datasets, widgets, refreshSec, locked }, null, 2)}\n`;
}

export async function fileStamp(path: string): Promise<string> {
  const info = await stat(path);
  return `${info.mtime?.getTime() ?? 0}:${info.size}`;
}

export async function pickDashboardFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Dashboard", extensions: ["json"] }],
  });
  return typeof picked === "string" ? picked : null;
}

export async function pickDashboardTarget(name: string): Promise<string | null> {
  return await save({
    defaultPath: `${name.replace(/[^\w-]+/g, "_") || "dashboard"}.json`,
    filters: [{ name: "Dashboard", extensions: ["json"] }],
  });
}

export async function readDashboardFile(
  path: string,
): Promise<{ dashboard: DashboardFile; stamp: string }> {
  const [text, stamp] = await Promise.all([readTextFile(path), fileStamp(path)]);
  return { dashboard: parseDashboard(text), stamp };
}

export async function writeDashboardFile(path: string, dashboard: Dashboard): Promise<string> {
  await writeTextFile(path, serializeDashboard(dashboard));
  return await fileStamp(path);
}

export function fileLabel(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
