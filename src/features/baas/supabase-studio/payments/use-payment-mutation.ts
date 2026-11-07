import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import {
  type PaymentAction,
  type PaymentIntent,
  type PaymentRecord,
  type PaymentResource,
  paymentIntent,
  paymentsKey,
  paymentsMutate,
} from "@/lib/db/payments";

export function usePaymentMutation(
  reference: string,
  refresh: PaymentResource[],
  onSuccess?: (record: PaymentRecord) => void,
) {
  const queryClient = useQueryClient();
  const intent = useRef<PaymentIntent | null>(null);
  return useMutation({
    mutationFn: (action: PaymentAction) => {
      intent.current = paymentIntent(intent.current, action);
      return paymentsMutate(reference, action, intent.current.id);
    },
    onSuccess: async (record) => {
      intent.current = null;
      onSuccess?.(record);
      await Promise.all(
        refresh.map((resource) =>
          queryClient.invalidateQueries({ queryKey: [...paymentsKey(reference), resource] }),
        ),
      );
    },
  });
}
