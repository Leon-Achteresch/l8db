import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAYMENT_QUERY_OPTIONS,
  type PaymentStatus,
  paymentsKey,
  paymentsSetup,
  paymentsSetupPreview,
} from "@/lib/db/payments";
import { SupabaseFunctionConfirmDialog } from "../functions/supabase-function-confirm-dialog";

const ORIGIN = /^(https:\/\/[^/\s?#@]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/?$/;

export function PaymentsSetupPanel({
  reference,
  status,
}: {
  reference: string;
  status: PaymentStatus;
}) {
  const queryClient = useQueryClient();
  const [origin, setOrigin] = useState(status.origin ?? "");
  const [reviewed, setReviewed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const preview = useQuery({
    queryKey: [...paymentsKey(reference), "setup-preview"],
    queryFn: () => paymentsSetupPreview(reference),
    ...PAYMENT_QUERY_OPTIONS,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const setup = useMutation({
    mutationFn: () => paymentsSetup(reference, origin, true),
    onSuccess: async () => {
      setConfirming(false);
      setReviewed(false);
      await queryClient.invalidateQueries({ queryKey: [...paymentsKey(reference), "status"] });
    },
  });
  const valid = ORIGIN.test(origin.trim()) && reviewed && preview.isSuccess;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Status</span>
        {status.setup_current ? (
          <Badge variant="secondary">Eingerichtet für {status.account_id}</Badge>
        ) : (
          <Badge variant="outline">Einrichtung nötig</Badge>
        )}
        {status.webhook_id && <span className="font-mono text-[11px]">{status.webhook_id}</span>}
      </div>
      <div className="max-w-xl space-y-1.5">
        <Label htmlFor="payments-origin" className="text-xs">
          App-Adresse für Checkout-Rückkehr und CORS
        </Label>
        <Input
          id="payments-origin"
          className="h-8 font-mono text-xs"
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          placeholder="https://app.example.com"
          aria-invalid={origin !== "" && !ORIGIN.test(origin.trim())}
        />
        <p className="text-[11px] text-muted-foreground">
          Nur Schema, Host und Port. Nach dem Bezahlen leitet Stripe auf /billing dieser Adresse
          zurück.
        </p>
      </div>
      {preview.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(preview.error)}
        </p>
      )}
      {preview.data && (
        <div className="space-y-3 rounded-lg border p-3 text-xs">
          <p className="font-medium">Vorschau der Änderungen</p>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>
              Privates Schema <span className="font-mono">{preview.data.schema}</span> mit RLS und
              zwei RPC-Funktionen nur für service_role anlegen oder aktualisieren.
            </li>
            <li>
              Stripe-Webhook an <span className="font-mono">{preview.data.webhook_url}</span> (API{" "}
              {preview.data.api_version}, {preview.data.events.length} Ereignisse) anlegen oder
              wiederverwenden.
            </li>
            <li>
              Function-Secrets setzen:{" "}
              <span className="font-mono">{preview.data.secrets.join(", ")}</span>
            </li>
            <li>
              Edge Functions bereitstellen:{" "}
              {preview.data.functions.map((fn) => (
                <span key={fn.slug} className="mr-2 font-mono">
                  {fn.url}
                </span>
              ))}
              (JWT-Prüfung im Funktionscode, Stripe-Signatur im Webhook)
            </li>
          </ol>
          <details>
            <summary className="cursor-pointer text-muted-foreground">SQL anzeigen</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
              {preview.data.sql}
            </pre>
          </details>
          {preview.data.functions.map((fn) => (
            <details key={fn.slug}>
              <summary className="cursor-pointer text-muted-foreground">
                Quelltext {fn.slug}
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
                {fn.source}
              </pre>
            </details>
          ))}
          <div className="flex items-center gap-2">
            <Checkbox
              id="payments-reviewed"
              checked={reviewed}
              onCheckedChange={(checked) => setReviewed(checked === true)}
            />
            <Label htmlFor="payments-reviewed" className="text-xs">
              Ich habe die Vorschau geprüft.
            </Label>
          </div>
        </div>
      )}
      <Button size="sm" disabled={!valid || setup.isPending} onClick={() => setConfirming(true)}>
        {status.setup_current ? "Einrichtung erneut ausführen" : "Einrichten"}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Jeder Schritt ist wiederholbar. Bricht die Einrichtung ab, setzt der nächste Lauf dort fort,
        ohne einen zweiten Webhook anzulegen.
      </p>
      {setup.data && (
        <div className="space-y-1 rounded-lg border p-3 text-xs">
          <p className="font-medium">Eingerichtet</p>
          <p>
            Checkout und Portal: <span className="font-mono">{setup.data.checkout_url}</span>
          </p>
          <p className="text-muted-foreground">
            Aufruf aus der App per POST mit Supabase-Session: {"{"} action: "checkout", price,
            requestId {"}"} oder {"{"} action: "portal", requestId {"}"}.
          </p>
        </div>
      )}
      <SupabaseFunctionConfirmDialog
        open={confirming}
        title={status.test_mode ? "Zahlungen einrichten?" : "Zahlungen im LIVE-Modus einrichten?"}
        description={`Schema, Webhook, Secrets und zwei Edge Functions werden in ${reference} angelegt oder überschrieben.${status.test_mode ? "" : " Der Live-Schlüssel wird als Function-Secret hinterlegt."}${setup.isError ? ` Fehler: ${String(setup.error)}` : ""}`}
        action="Einrichten"
        busy={setup.isPending}
        onConfirm={() => setup.mutate()}
        onOpenChange={setConfirming}
      />
    </div>
  );
}
