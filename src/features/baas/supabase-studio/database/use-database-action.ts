import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type DatabaseAction,
  supabaseStudioDatabaseAction,
} from "@/lib/db/supabase-studio-database";

export function useDatabaseAction(reference: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: DatabaseAction) => supabaseStudioDatabaseAction(reference, action),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["supabase", reference, "studio-database"] }),
    onError: (error) => toast.error(String(error)),
  });
}
