import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { ConvexSchedulesConfirm } from "./convex-schedules-confirm-dialog";

export function useSchedulesConfirm(queryKey: unknown[]) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<ConvexSchedulesConfirm | null>(null);
  const mutation = useMutation({
    mutationFn: (target: ConvexSchedulesConfirm) => target.run(),
    onSuccess: (_, target) => {
      toast.success(`${target.action}: erledigt`);
      setConfirm(null);
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  return {
    setConfirm,
    dialog: {
      confirm,
      busy: mutation.isPending,
      onConfirm: (target: ConvexSchedulesConfirm) => mutation.mutate(target),
      onClose: () => setConfirm(null),
    },
  };
}
