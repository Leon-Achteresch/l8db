import { Code2, Database, FolderOpen, Globe, type LucideIcon, Rocket, Users } from "lucide-react";
import type { BaasProvider } from "./baas-providers";

export type BaasSection = "database" | "storage" | "auth" | "functions" | "hosting" | "deployments";

export const SECTION_INFO: Record<BaasSection, { label: string; icon: LucideIcon }> = {
  database: { label: "Datenbank", icon: Database },
  storage: { label: "Storage", icon: FolderOpen },
  auth: { label: "Auth", icon: Users },
  functions: { label: "Functions", icon: Code2 },
  hosting: { label: "Hosting", icon: Globe },
  deployments: { label: "Deployments", icon: Rocket },
};

export const PROVIDER_SECTIONS: Record<BaasProvider, BaasSection[]> = {
  supabase: ["database", "storage", "auth", "functions"],
  appwrite: ["database", "storage", "auth", "functions"],
  pocketbase: ["database", "auth"],
  convex: ["deployments"],
  firebase: ["database", "storage", "auth", "functions", "hosting"],
};

export const DATABASE_LABEL: Record<BaasProvider, string> = {
  supabase: "PostgreSQL",
  appwrite: "TablesDB",
  pocketbase: "Collections",
  convex: "Deployments",
  firebase: "Firestore",
};
