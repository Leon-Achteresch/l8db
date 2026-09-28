export type BaasProvider = "supabase" | "appwrite" | "pocketbase" | "convex" | "firebase";

export const BAAS_PROVIDERS: { id: BaasProvider; name: string }[] = [
  { id: "supabase", name: "Supabase" },
  { id: "appwrite", name: "Appwrite" },
  { id: "pocketbase", name: "PocketBase" },
  { id: "convex", name: "Convex" },
  { id: "firebase", name: "Firebase" },
];
