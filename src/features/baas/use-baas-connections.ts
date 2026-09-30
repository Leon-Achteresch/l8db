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
}

export function useBaasConnections(): BaasConnection[] {
  const supabase = useQuery({ queryKey: ["supabase", "connected"], queryFn: supabaseIsConnected });
  const [projects, appwrite, pocketbase, convex, firebase] = useQueries({
    queries: [
      {
        queryKey: ["supabase", "projects"],
        queryFn: supabaseProjects,
        enabled: supabase.data === true,
      },
      { queryKey: ["appwrite", "profiles"], queryFn: appwriteProfiles },
      { queryKey: ["pocketbase", "profiles"], queryFn: pocketbaseProfiles },
      { queryKey: ["convex", "profiles"], queryFn: convexProfiles },
      { queryKey: ["firebase", "profiles"], queryFn: firebaseProfiles },
    ],
  });
  const supabaseEmpty = supabase.data === true && projects.data?.length === 0;
  return [
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
    ...(supabase.data ? (projects.data ?? []) : []).map((item) => ({
      provider: "supabase" as const,
      id: item.reference,
      name: item.name,
      detail: item.region ?? item.reference,
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
      name: `Convex-Team ${item.team_id}`,
      detail: `Team ${item.team_id}`,
    })),
    ...(firebase.data ?? []).map((item) => ({
      provider: "firebase" as const,
      id: item.projectId,
      name: item.displayName || item.projectId,
      detail: item.projectId,
    })),
  ];
}
