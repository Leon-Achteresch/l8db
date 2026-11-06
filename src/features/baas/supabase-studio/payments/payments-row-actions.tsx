import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { belongsToProject, type PaymentRecord, type PaymentResource } from "@/lib/db/payments";
import { SupabaseFunctionConfirmDialog } from "../functions/supabase-function-confirm-dialog";
import { PaymentsLinkResult } from "./payments-link-result";
import { usePaymentMutation } from "./use-payment-mutation";

const REFRESH: Record<PaymentResource, PaymentResource[]> = {
  products: ["products", "prices"],
  prices: ["prices"],
  customers: ["customers"],
  subscriptions: ["subscriptions"],
  invoices: ["invoices"],
};

export function PaymentsRowActions({
  reference,
  resource,
  row,
  live,
}: {
  reference: string;
  resource: PaymentResource;
  row: PaymentRecord;
  live: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [link, setLink] = useState<{ url: string; kind: "checkout" | "portal" } | null>(null);
  const mutation = usePaymentMutation(reference, REFRESH[resource], (record) => {
    setConfirm(false);
    if (record.url)
      setLink({ url: record.url, kind: resource === "customers" ? "portal" : "checkout" });
  });
  const liveNote = live ? " Achtung: Live-Modus, die Änderung betrifft echte Kunden." : "";
  const failure = mutation.isError ? ` Fehler: ${String(mutation.error)}` : "";

  if (resource === "invoices") {
    return row.hosted_invoice_url ? (
      <Button
        size="xs"
        variant="ghost"
        onClick={() =>
          row.hosted_invoice_url &&
          openUrl(row.hosted_invoice_url).catch(() =>
            toast.error("Rechnung konnte nicht geöffnet werden"),
          )
        }
      >
        Öffnen
      </Button>
    ) : null;
  }
  if (!belongsToProject(row, reference)) {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        title={`Nur Objekte mit Metadatum l8db_project = ${reference} sind hier änderbar.`}
      >
        nur lesen
      </span>
    );
  }

  const action = (() => {
    if (resource === "products" && row.active) {
      return (
        <Button
          size="xs"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => setConfirm(true)}
        >
          Archivieren
        </Button>
      );
    }
    if (resource === "prices" && row.active) {
      return (
        <Button
          size="xs"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({ action: "create_checkout", price: row.id, customer: null })
          }
        >
          {mutation.isPending ? "Wird erstellt…" : "Checkout-Link"}
        </Button>
      );
    }
    if (resource === "customers") {
      return (
        <Button
          size="xs"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ action: "create_portal", customer: row.id })}
        >
          {mutation.isPending ? "Wird erstellt…" : "Portal-Link"}
        </Button>
      );
    }
    if (resource === "subscriptions" && row.status !== "canceled" && !row.cancel_at_period_end) {
      return (
        <Button
          size="xs"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => setConfirm(true)}
        >
          Kündigen
        </Button>
      );
    }
    return null;
  })();

  return (
    <div className="flex flex-col items-end gap-1">
      {action}
      {mutation.isError && !confirm && (
        <p role="alert" className="max-w-56 text-right text-[11px] text-destructive">
          {String(mutation.error)}
        </p>
      )}
      <SupabaseFunctionConfirmDialog
        open={confirm}
        title={resource === "products" ? "Produkt archivieren?" : "Abo zum Periodenende kündigen?"}
        description={
          resource === "products"
            ? `${row.name ?? row.id} wird archiviert und kann nicht mehr neu gekauft werden. Bestehende Abos laufen weiter.${liveNote}${failure}`
            : `Das Abo ${row.id} bleibt bis zum Ende der bezahlten Periode aktiv und verlängert sich danach nicht.${liveNote}${failure}`
        }
        action={resource === "products" ? "Archivieren" : "Kündigen"}
        busy={mutation.isPending}
        onConfirm={() =>
          mutation.mutate(
            resource === "products"
              ? { action: "archive_product", id: row.id }
              : { action: "cancel_subscription", id: row.id },
          )
        }
        onOpenChange={setConfirm}
      />
      <PaymentsLinkResult link={link} onClose={() => setLink(null)} />
    </div>
  );
}
