import { useConvexFunctionHistory } from "@/features/baas/convex-studio/functions/convex-function-history-store";
import {
  appwriteDisconnect,
  convexDisconnect,
  firebaseDisconnect,
  pocketbaseDisconnect,
  supabaseDisconnect,
  supabaseDisconnectSelfHosted,
} from "@/lib/db";
import type { BaasConnection } from "./use-baas-connections";

export function disconnectBaas({ provider, id, url }: BaasConnection) {
  if (provider === "supabase") return url ? supabaseDisconnectSelfHosted(id) : supabaseDisconnect();
  if (provider === "appwrite") return appwriteDisconnect(id);
  if (provider === "pocketbase") return pocketbaseDisconnect(id);
  if (provider === "convex") {
    useConvexFunctionHistory.getState().clearProfile(id);
    return convexDisconnect(id);
  }
  return firebaseDisconnect(id);
}
