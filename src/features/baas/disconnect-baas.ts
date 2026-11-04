import { useConvexFunctionHistory } from "@/features/baas/convex-studio/functions/convex-function-history-store";
import {
  appwriteDisconnect,
  convexDisconnect,
  firebaseDisconnect,
  pocketbaseDisconnect,
  supabaseDisconnect,
  supabaseDisconnectSelfHosted,
} from "@/lib/db";
import { forgetSupabaseSqlProjects } from "./supabase-studio/sql/supabase-sql-store";
import { forgetRecentTables } from "./supabase-studio/tables/supabase-tables-utils";
import type { BaasConnection } from "./use-baas-connections";

export async function disconnectSupabase(reference: string, selfHosted: boolean) {
  if (selfHosted) await supabaseDisconnectSelfHosted(reference);
  else await supabaseDisconnect();
  const match = selfHosted
    ? (candidate: string) => candidate === reference
    : (candidate: string) => !candidate.startsWith("self-");
  forgetSupabaseSqlProjects(match);
  forgetRecentTables(match);
}

export function disconnectDescription(name: string, supabaseCloud = false): string {
  return supabaseCloud
    ? "Der Supabase-Zugangstoken wird aus dem Schlüsselbund entfernt. Das betrifft alle Supabase-Cloud-Projekte. Verbundene Datenbanken bleiben als Verbindung erhalten."
    : `„${name}“ und die gespeicherten Zugangsdaten werden aus l8db entfernt. Das Projekt selbst bleibt erhalten.`;
}

export function disconnectBaas({ provider, id, url }: BaasConnection) {
  if (provider === "supabase") return disconnectSupabase(id, Boolean(url));
  if (provider === "appwrite") return appwriteDisconnect(id);
  if (provider === "pocketbase") return pocketbaseDisconnect(id);
  if (provider === "convex") {
    useConvexFunctionHistory.getState().clearProfile(id);
    return convexDisconnect(id);
  }
  return firebaseDisconnect(id);
}
