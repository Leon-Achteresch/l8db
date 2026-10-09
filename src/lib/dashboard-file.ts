import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { validateDashboardDesign } from "@/lib/dashboard-design";
import type { Dashboard, DashboardPage } from "@/lib/dashboards/model";
import { sanitizeTheme } from "@/lib/dashboards/theme";

export type DashboardFile = Omit<
  Dashboard,
  "id" | "connectionId" | "database" | "createdAt" | "filePath" | "fileStamp"
>;

export function parseDashboard(text: string): DashboardFile {
  const parsed = JSON.parse(text) as DashboardFile;
  if (!Array.isArray(parsed.widgets) || !Array.isArray(parsed.datasets))
    throw new Error("Ungültiges Dashboard-Format");
  if (parsed.design != null) validateDashboardDesign(parsed.design);
  else delete parsed.design;
  const theme = sanitizeTheme(parsed.theme);
  if (theme) parsed.theme = theme;
  else delete parsed.theme;
  const pages = sanitizePages(parsed.pages);
  if (pages.length) parsed.pages = pages;
  else delete parsed.pages;
  return parsed;
}

export function sanitizePages(value: unknown): DashboardPage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const pages: DashboardPage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, hidden } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || seen.has(id)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    seen.add(id);
    pages.push({ id, name: name.trim().slice(0, 60), ...(hidden === true ? { hidden } : {}) });
  }
  return pages.slice(0, 30);
}

export function dashboardSqlParts(dashboard: Pick<Dashboard, "datasets" | "variables">): string[] {
  return [
    ...dashboard.datasets
      .filter((d) => d.mode === "expert" && d.sql?.trim())
      .map((d) => `${d.name}:\n${d.sql.trim()}`),
    ...dashboard.datasets.flatMap((d) =>
      d.mode === "expert"
        ? []
        : (d.simple?.calculated ?? [])
            .filter((field) => field.expr?.trim())
            .map((field) => `${d.name} · Formel ${field.label}:\n${field.expr.trim()}`),
    ),
    ...(dashboard.variables ?? [])
      .filter((v) => v.optionsSql?.trim())
      .map((v) => `Filter ${v.label}:\n${v.optionsSql?.trim()}`),
  ];
}

export function confirmExpertSql(dashboard: DashboardFile): boolean {
  const queries = dashboardSqlParts(dashboard);
  if (!queries.length) return true;
  return window.confirm(
    `Das Dashboard enthält ${queries.length} SQL-Abfrage(n), die direkt auf der Datenbank ausgeführt werden:\n\n${queries.join("\n\n")}\n\nFortfahren?`,
  );
}

export function serializeDashboard(dashboard: Dashboard): string {
  const { name, datasets, widgets, variables, refreshSec, locked, design, pages, theme } =
    dashboard;
  return `${JSON.stringify({ name, datasets, widgets, ...(variables?.length ? { variables } : {}), ...(pages?.length ? { pages } : {}), ...(theme ? { theme } : {}), refreshSec, locked, ...(design ? { design } : {}) }, null, 2)}\n`;
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
