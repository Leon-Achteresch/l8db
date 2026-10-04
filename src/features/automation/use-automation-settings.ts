import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/automation/toast";
import {
  type AutomationSettings,
  getAutomationSettings,
  saveAutomationSettings,
} from "@/lib/db/automation";

export const AUTOMATION_SETTINGS_KEY = ["automation", "settings"] as const;

export function useAutomationSettings() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: AUTOMATION_SETTINGS_KEY,
    queryFn: getAutomationSettings,
    staleTime: 30_000,
    retry: 1,
  });
  const mutation = useMutation({
    mutationFn: saveAutomationSettings,
    onMutate: async (next: AutomationSettings) => {
      await client.cancelQueries({ queryKey: AUTOMATION_SETTINGS_KEY });
      const previous = client.getQueryData<AutomationSettings>(AUTOMATION_SETTINGS_KEY);
      client.setQueryData(AUTOMATION_SETTINGS_KEY, next);
      return { previous };
    },
    onError: (error, _next, context) => {
      if (context?.previous) client.setQueryData(AUTOMATION_SETTINGS_KEY, context.previous);
      toast.error(error instanceof Error ? error.message : String(error));
    },
    onSuccess: (saved) => client.setQueryData(AUTOMATION_SETTINGS_KEY, saved),
  });
  const save = async (patch: Partial<AutomationSettings>) => {
    const current = client.getQueryData<AutomationSettings>(AUTOMATION_SETTINGS_KEY) ?? query.data;
    if (!current) throw new Error("Einstellungen sind noch nicht geladen.");
    return mutation.mutateAsync({ ...current, ...patch });
  };
  const update = (patch: Partial<AutomationSettings>) => save(patch).catch(() => undefined);
  return { settings: query.data, error: query.error, loading: query.isLoading, update, save };
}
