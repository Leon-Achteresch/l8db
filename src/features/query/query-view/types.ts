import type { SavedConnection } from "@/lib/connections";
import type { useCapabilities } from "@/lib/providers";
import type { useQueryWorkspace } from "@/lib/query-workspace";

export type QueryViewConnection = SavedConnection | null;
export type QueryViewCapabilities = ReturnType<typeof useCapabilities>;
export type QueryWorkspaceStore = ReturnType<typeof useQueryWorkspace.getState>;
export type QueryWorkspaceState = Omit<QueryWorkspaceStore, "navigatorVisible" | "navigatorShare">;
export type AnalysisSection = "plan" | "perf";
