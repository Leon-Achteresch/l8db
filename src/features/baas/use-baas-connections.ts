import { useQueries, useQuery } from "@tanstack/react-query";
import {
  appwriteProfiles,
  convexProfiles,
  firebaseProfiles,
  pocketbaseProfiles,
  supabaseIsConnected,
  supabaseProjects,
} from "@/lib/db";
import type { BaasProvider } from "./baas-providers";

export interface BaasConnection {
  provider: BaasProvider;
  id: string;
  name: string;
  detail: string;
  url?: string;
}

export function useBaasConnections(enabled = true): BaasConnection[] {
  const supabase = useQuery({
    queryKey: ["supabase", "connected"],
    queryFn: supabaseIsConnected,
    enabled,
  });
  const [projects, appwrite, pocketbase, convex, firebase] = useQueries({
    queries: [
      {
        queryKey: ["supabase", "projects"],
        queryFn: supabaseProjects,
        enabled: enabled && supabase.data === true,
      },
      { queryKey: ["appwrite", "profiles"], queryFn: appwriteProfiles, enabled },
      { queryKey: ["pocketbase", "profiles"], queryFn: pocketbaseProfiles, enabled },
      { queryKey: ["convex", "profiles"], queryFn: convexProfiles, enabled },
      { queryKey: ["firebase", "profiles"], queryFn: firebaseProfiles, enabled },
    ],
  });
  const supabaseEmpty = supabase.data === true && projects.data?.projects.length === 0;
  const failures = [
    { provider: "supabase" as const, name: "Supabase", query: projects },
    { provider: "appwrite" as const, name: "Appwrite", query: appwrite },
    { provider: "pocketbase" as const, name: "PocketBase", query: pocketbase },
    { provider: "convex" as const, name: "Convex", query: convex },
    { provider: "firebase" as const, name: "Firebase", query: firebase },
  ].flatMap(({ provider, name, query }) =>
    query.isError ? [{ provider, id: "", name, detail: `Fehler: ${String(query.error)}` }] : [],
  );
  const cloudError = supabase.data ? projects.data?.cloud_error : null;
  return [
    ...failures,
    ...(cloudError
      ? [
          {
            provider: "supabase" as const,
            id: "",
            name: "Supabase Cloud",
            detail: `Fehler: ${cloudError}`,
          },
        ]
      : []),
    ...(supabaseEmpty
      ? [
          {
            provider: "supabase" as const,
            id: "",
            name: "Supabase",
            detail: "Keine Projekte sichtbar",
          },
        ]
      : []),
    ...(supabase.data ? (projects.data?.projects ?? []) : []).map((item) => ({
      provider: "supabase" as const,
      id: item.reference,
      name: item.name,
      detail: item.api_url ?? item.region ?? item.reference,
      url: item.api_url ?? undefined,
    })),
    ...(appwrite.data ?? []).map((item) => ({
      provider: "appwrite" as const,
      id: item.id,
      name: item.name || item.project_id,
      detail: item.endpoint,
    })),
    ...(pocketbase.data ?? []).map((item) => ({
      provider: "pocketbase" as const,
      id: item.id,
      name: item.name || item.endpoint,
      detail: item.endpoint,
    })),
    ...(convex.data ?? []).map((item) => ({
      provider: "convex" as const,
      id: item.id,
      name: item.url ? "Convex (selbst gehostet)" : `Convex-Team ${item.team_id}`,
      detail: item.url ?? `Team ${item.team_id}`,
    })),
    ...(firebase.data ?? []).map((item) => ({
      provider: "firebase" as const,
      id: item.projectId,
      name: item.displayName || item.projectId,
      detail: item.projectId,
    })),
  ];
}
