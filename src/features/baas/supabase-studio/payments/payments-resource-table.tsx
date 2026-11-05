import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  belongsToProject,
  formatAmount,
  formatStripeDate,
  PAYMENT_MAX_PAGES,
  PAYMENT_PAGE_LIMIT,
  PAYMENT_QUERY_OPTIONS,
  type PaymentRecord,
  type PaymentResource,
  type PaymentScope,
  paymentsKey,
  paymentsList,
  subscriptionPeriodEnd,
} from "@/lib/db/payments";

type Column = { label: string; cell: (row: PaymentRecord) => ReactNode };

const INTERVALS: Record<string, string> = {
  day: "täglich",
  week: "wöchentlich",
  month: "monatlich",
  year: "jährlich",
};

const STATUS: Record<string, string> = {
  active: "aktiv",
  trialing: "Testphase",
  past_due: "überfällig",
  unpaid: "unbezahlt",
  canceled: "beendet",
  incomplete: "unvollständig",
  incomplete_expired: "abgelaufen",
  paused: "pausiert",
  draft: "Entwurf",
  open: "offen",
  paid: "bezahlt",
  void: "storniert",
  uncollectible: "uneinbringlich",
};

const mono = (value: ReactNode) => <span className="font-mono text-[11px]">{value}</span>;
const active = (row: PaymentRecord) => (row.active ? "aktiv" : "archiviert");

const COLUMNS: Record<PaymentResource, Column[]> = {
  products: [
    { label: "Name", cell: (row) => row.name ?? "–" },
    { label: "ID", cell: (row) => mono(row.id) },
    { label: "Status", cell: active },
    { label: "Erstellt", cell: (row) => formatStripeDate(row.created) },
  ],
  prices: [
    {
      label: "Preis",
      cell: (row) =>
        `${formatAmount(row.unit_amount, row.currency)}${row.recurring?.interval ? ` ${INTERVALS[row.recurring.interval] ?? row.recurring.interval}` : " einmalig"}`,
    },
    { label: "Produkt", cell: (row) => mono(row.product ?? "–") },
    { label: "ID", cell: (row) => mono(row.id) },
    { label: "Status", cell: active },
  ],
  customers: [
    { label: "E-Mail", cell: (row) => row.email ?? "–" },
    { label: "Name", cell: (row) => row.name ?? "–" },
    { label: "ID", cell: (row) => mono(row.id) },
    { label: "Erstellt", cell: (row) => formatStripeDate(row.created) },
  ],
  subscriptions: [
    { label: "Kunde", cell: (row) => mono(row.customer ?? "–") },
    {
      label: "Status",
      cell: (row) =>
        `${STATUS[row.status ?? ""] ?? row.status ?? "–"}${row.cancel_at_period_end ? ", endet zum Periodenende" : ""}`,
    },
    { label: "Periodenende", cell: (row) => formatStripeDate(subscriptionPeriodEnd(row)) },
    { label: "ID", cell: (row) => mono(row.id) },
  ],
  invoices: [
    { label: "Nummer", cell: (row) => row.number ?? mono(row.id) },
    { label: "Kunde", cell: (row) => row.customer_email ?? mono(row.customer ?? "–") },
    { label: "Betrag", cell: (row) => formatAmount(row.total, row.currency) },
    { label: "Status", cell: (row) => STATUS[row.status ?? ""] ?? row.status ?? "–" },
  ],
};

export function PaymentsResourceTable({
  reference,
  resource,
  scope,
  actions,
}: {
  reference: string;
  resource: PaymentResource;
  scope: PaymentScope;
  actions: (row: PaymentRecord) => ReactNode;
}) {
  const list = useInfiniteQuery({
    queryKey: [...paymentsKey(reference), resource, scope],
    queryFn: ({ pageParam }) => paymentsList(reference, resource, scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    maxPages: PAYMENT_MAX_PAGES,
    ...PAYMENT_QUERY_OPTIONS,
  });
  const pages = list.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.data);
  const columns = COLUMNS[resource];

  return (
    <div className="space-y-2">
      {list.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(list.error)}
        </p>
      )}
      {list.isLoading && <p className="text-xs text-muted-foreground">Wird aus Stripe geladen…</p>}
      {list.data && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column.label} className="py-1 font-medium">
                  {column.label}
                </th>
              ))}
              <th className="py-1 font-medium">Bereich</th>
              <th className="py-1 text-right font-medium">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                {columns.map((column) => (
                  <td key={column.label} className="max-w-64 truncate py-1.5 pr-2">
                    {column.cell(row)}
                  </td>
                ))}
                <td className="py-1.5">
                  {belongsToProject(row, reference) ? (
                    <Badge variant="secondary">Projekt</Badge>
                  ) : (
                    <Badge variant="outline">Konto</Badge>
                  )}
                </td>
                <td className="py-1.5 text-right">{actions(row)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="py-3 text-muted-foreground">
                  {scope === "project"
                    ? "Keine Einträge mit l8db_project für dieses Projekt. Neue Einträge erscheinen in der Stripe-Suche nach bis zu einer Minute."
                    : "Keine Einträge im Stripe-Konto."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>
          {rows.length} Einträge geladen, je Seite höchstens {PAYMENT_PAGE_LIMIT}
          {pages.length >= PAYMENT_MAX_PAGES && list.hasNextPage
            ? `; ältere Seiten werden nach ${PAYMENT_MAX_PAGES} Seiten verworfen`
            : ""}
        </span>
        <span className="flex gap-2">
          <Button
            size="xs"
            variant="ghost"
            disabled={list.isFetching}
            onClick={() => list.refetch()}
          >
            Neu laden
          </Button>
          {list.hasNextPage && (
            <Button
              size="xs"
              variant="outline"
              disabled={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage({ cancelRefetch: false })}
            >
              {list.isFetchingNextPage ? "Lädt…" : "Weitere laden"}
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
