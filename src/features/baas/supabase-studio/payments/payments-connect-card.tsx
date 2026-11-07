import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isLiveKey,
  isStripeKey,
  type PaymentStatus,
  paymentsConnect,
  paymentsDisconnect,
  paymentsKey,
} from "@/lib/db/payments";
import { SupabaseFunctionConfirmDialog } from "../functions/supabase-function-confirm-dialog";

const DISCONNECTED: PaymentStatus = {
  connected: false,
  test_mode: true,
  account_id: null,
  origin: null,
  webhook_id: null,
  setup_current: false,
};

export function PaymentsConnectCard({
  reference,
  status,
}: {
  reference: string;
  status: PaymentStatus | null;
}) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [allowLive, setAllowLive] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const live = isLiveKey(key);
  const reset = (next: PaymentStatus) => {
    queryClient.removeQueries({
      queryKey: paymentsKey(reference),
      predicate: (query) => query.queryKey[3] !== "status",
    });
    queryClient.setQueryData([...paymentsKey(reference), "status"], next);
  };
  const connect = useMutation({
    mutationFn: () => paymentsConnect(reference, key, live && allowLive),
    onSuccess: (next) => {
      setKey("");
      setAllowLive(false);
      reset(next);
    },
  });
  const disconnect = useMutation({
    mutationFn: () => paymentsDisconnect(reference),
    onSuccess: () => {
      setConfirmDisconnect(false);
      reset(DISCONNECTED);
    },
  });
  const valid = isStripeKey(key) && (!live || allowLive);

  return (
    <div className="max-w-2xl space-y-4">
      <form
        className="space-y-3"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !connect.isPending) connect.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="payments-key" className="text-xs">
            {status?.connected ? "Stripe-Schlüssel ersetzen" : "Stripe Secret oder Restricted Key"}
          </Label>
          <Input
            id="payments-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="h-8 font-mono text-xs"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="sk_test_… oder rk_test_…"
          />
          <p className="text-[11px] text-muted-foreground">
            Der Schlüssel wird nur im System-Schlüsselbund gespeichert und nie wieder angezeigt.
            Empfohlen ist ein Restricted Key mit Schreibrechten für Products, Prices, Customers,
            Subscriptions, Checkout Sessions, Customer Portal und Webhook Endpoints.
          </p>
        </div>
        {live && (
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">Live-Schlüssel erkannt</p>
            <p className="text-[11px] text-muted-foreground">
              Änderungen betreffen echte Kunden und Zahlungen. Teste zuerst mit einem
              sk_test-Schlüssel.
            </p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="payments-live"
                checked={allowLive}
                onCheckedChange={(checked) => setAllowLive(checked === true)}
              />
              <Label htmlFor="payments-live" className="text-xs">
                Ich bestätige den Live-Modus mit echten Zahlungen.
              </Label>
            </div>
          </div>
        )}
        {status?.connected && (
          <p className="text-[11px] text-muted-foreground">
            Ein anderes Stripe-Konto oder ein Wechsel zwischen Test und Live verwirft den
            gespeicherten Webhook. Danach die Einrichtung erneut ausführen.
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={!valid || connect.isPending}>
            {connect.isPending
              ? "Wird geprüft…"
              : status?.connected
                ? "Schlüssel ersetzen"
                : "Verbinden"}
          </Button>
          {status?.connected && (
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setConfirmDisconnect(true)}
            >
              Trennen
            </Button>
          )}
        </div>
        {connect.isError && (
          <p role="alert" className="text-xs text-destructive">
            {String(connect.error)}
          </p>
        )}
      </form>
      <SupabaseFunctionConfirmDialog
        open={confirmDisconnect}
        title="Stripe trennen?"
        description={`Der Schlüssel wird aus dem Schlüsselbund dieses Geräts entfernt. Bereits eingerichtete Supabase-Funktionen behalten ihre Secrets und laufen weiter.${disconnect.isError ? ` Fehler: ${String(disconnect.error)}` : ""}`}
        action="Trennen"
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        onOpenChange={setConfirmDisconnect}
      />
    </div>
  );
}
