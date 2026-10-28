import { useQuery } from "@tanstack/react-query";
import { supabaseHealth } from "@/lib/db";

export function useSupabaseHealth(reference: string) {
  return useQuery({
    queryKey: ["supabase", reference, "health"],
    queryFn: () => supabaseHealth(reference),
    staleTime: 30_000,
  });
}
