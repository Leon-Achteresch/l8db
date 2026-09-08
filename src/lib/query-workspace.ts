import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { QueryRunTarget } from "@/lib/query-run-target";

export interface QueryWorkspaceOptions {
  layout: "vertical" | "horizontal";
  editorShare: number;
  navigatorVisible: boolean;
  navigatorShare: number;
  toolsVisible: boolean;
  navigationTools: boolean;
  fileTools: boolean;
  analysisTools: boolean;
  runTarget: QueryRunTarget;
  statusVisible: boolean;
  folding: boolean;
  stickyScroll: boolean;
  insertSpaces: boolean;
  autoClosing: boolean;
  cursorStyle: "line" | "block" | "underline";
  cursorBlinking: "blink" | "smooth" | "solid";
  highlightLine: boolean;
  scrollBeyondLastLine: boolean;
  resultView: "table" | "json";
  resultFontSize: number;
  resultRowHeight: number;
  resultColumnWidth: number;
  stripedRows: boolean;
}

export const QUERY_WORKSPACE_DEFAULTS: QueryWorkspaceOptions = {
  layout: "vertical",
  editorShare: 55,
  navigatorVisible: false,
  navigatorShare: 22,
  toolsVisible: true,
  navigationTools: true,
  fileTools: true,
  analysisTools: true,
  runTarget: "selection-or-all",
  statusVisible: true,
  folding: true,
  stickyScroll: false,
  insertSpaces: true,
  autoClosing: true,
  cursorStyle: "line",
  cursorBlinking: "smooth",
  highlightLine: true,
  scrollBeyondLastLine: false,
  resultView: "table",
  resultFontSize: 12,
  resultRowHeight: 29,
  resultColumnWidth: 200,
  stripedRows: true,
};

export const QUERY_WORKSPACE_PRESETS = {
  focus: { layout: "vertical", editorShare: 75, toolsVisible: false, navigatorVisible: false },
  develop: { layout: "vertical", editorShare: 55, toolsVisible: true, navigatorVisible: true },
  analyze: { layout: "horizontal", editorShare: 40, toolsVisible: true, navigatorVisible: false },
} satisfies Record<string, Partial<QueryWorkspaceOptions>>;

export function sanitizeWorkspace(value: unknown): Partial<QueryWorkspaceOptions> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const choices: Record<string, string[]> = {
    layout: ["vertical", "horizontal"],
    runTarget: ["selection-or-all", "selection-or-statement", "all"],
    cursorStyle: ["line", "block", "underline"],
    cursorBlinking: ["blink", "smooth", "solid"],
    resultView: ["table", "json"],
  };
  const limits: Record<string, [number, number]> = {
    editorShare: [20, 80],
    navigatorShare: [15, 40],
    resultFontSize: [10, 20],
    resultRowHeight: [26, 48],
    resultColumnWidth: [100, 480],
  };
  for (const [key, fallback] of Object.entries(QUERY_WORKSPACE_DEFAULTS)) {
    const candidate = input[key];
    if (typeof fallback === "boolean" && typeof candidate === "boolean") output[key] = candidate;
    else if (choices[key] && typeof candidate === "string" && choices[key].includes(candidate))
      output[key] = candidate;
    else if (limits[key] && typeof candidate === "number" && Number.isFinite(candidate)) {
      output[key] = Math.min(limits[key][1], Math.max(limits[key][0], candidate));
    }
  }
  return output as Partial<QueryWorkspaceOptions>;
}

export const useQueryWorkspace = create<
  QueryWorkspaceOptions & {
    update: (patch: Partial<QueryWorkspaceOptions>) => void;
    reset: () => void;
  }
>()(
  persist(
    (set) => ({
      ...QUERY_WORKSPACE_DEFAULTS,
      update: (patch) => set(sanitizeWorkspace(patch)),
      reset: () => set(QUERY_WORKSPACE_DEFAULTS),
    }),
    {
      name: "l8db.query-workspace",
      partialize: (state) => sanitizeWorkspace(state),
      merge: (persisted, current) => ({ ...current, ...sanitizeWorkspace(persisted) }),
    },
  ),
);
