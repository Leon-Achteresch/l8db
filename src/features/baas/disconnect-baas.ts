import {
  appwriteDisconnect,
  convexDisconnect,
  firebaseDisconnect,
  pocketbaseDisconnect,
  supabaseDisconnect,
} from "@/lib/db";
import type { BaasConnection } from "./use-baas-connections";

export function disconnectBaas({ provider, id }: BaasConnection) {
  if (provider === "supabase") return supabaseDisconnect();
  if (provider === "appwrite") return appwriteDisconnect(id);
  if (provider === "pocketbase") return pocketbaseDisconnect(id);
  if (provider === "convex") return convexDisconnect(id);
  return firebaseDisconnect(id);
}
