import { useQueries } from "@tanstack/react-query";
import {
  appwriteProfiles,
  convexProfiles,
  firebaseProfiles,
  pocketbaseProfiles,
  supabaseIsConnected,
} from "@/lib/db";
import type { BaasProvider } from "./baas-providers";

export interface BaasConnection {
  provider: BaasProvider;
  id: string;
  name: string;
  detail: string;
}

export function useBaasConnections(): BaasConnection[] {
  const [supabase, appwrite, pocketbase, convex, firebase] = useQueries({
    queries: [
      { queryKey: ["supabase", "connected"], queryFn: supabaseIsConnected },
      { queryKey: ["appwrite", "profiles"], queryFn: appwriteProfiles },
      { queryKey: ["pocketbase", "profiles"], queryFn: pocketbaseProfiles },
      { queryKey: ["convex", "profiles"], queryFn: convexProfiles },
      { queryKey: ["firebase", "profiles"], queryFn: firebaseProfiles },
    ],
  });
  return [
    ...(supabase.data
      ? [
          {
            provider: "supabase" as const,
            id: "supabase",
            name: "Supabase",
            detail: "Alle Projekte des Zugangstokens",
          },
        ]
      : []),
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
      name: "Convex",
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
