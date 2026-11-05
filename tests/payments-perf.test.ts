import { describe, expect, mock, test } from "bun:test";
import {
  focusManager,
  InfiniteQueryObserver,
  onlineManager,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reportScenario } from "../scripts/performance-report";

const counts = new Map<string, number>();
const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    counts.set(command, (counts.get(command) ?? 0) + 1);
    const handler = handlers.get(command);
    return handler ? handler(args) : null;
  },
}));

const payments = await import("../src/lib/db/payments");
const { PaymentsResourceTable } = await import(
  "../src/features/baas/supabase-studio/payments/payments-resource-table"
);

const REF = "abcdefghijklmnopqrst";
const PAGES = 20;

function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction))] ?? 0;
}

function subscriptions(page: number) {
  return Array.from({ length: payments.PAYMENT_PAGE_LIMIT }, (_, index) => {
    const n = page * payments.PAYMENT_PAGE_LIMIT + index;
    return {
      id: `sub_${n.toString(36).padStart(8, "0")}`,
      object: "subscription",
      status: n % 7 === 0 ? "past_due" : "active",
      customer: `cus_${n.toString(36).padStart(8, "0")}`,
      cancel_at_period_end: n % 11 === 0,
      created: 1_760_000_000 + n,
      livemode: false,
      items: {
        data: [
          {
            current_period_end: 1_765_000_000 + n,
            price: {
              id: `price_${n % 4}`,
              currency: "eur",
              unit_amount: 990,
              recurring: { interval: "month" },
            },
          },
        ],
      },
      metadata: { l8db_project: n % 3 === 0 ? "other" : REF },
    };
  });
}

function list(args?: Record<string, unknown>) {
  const page = args?.cursor ? Number(String(args.cursor).slice(5)) : 0;
  return {
    data: subscriptions(page),
    has_more: page + 1 < PAGES,
    next_cursor: page + 1 < PAGES ? `page_${page + 1}` : null,
  };
}

describe("Zahlungen Performance", () => {
  test("20 Seiten à 100 Abos halten höchstens 5 Seiten und genau eine Anfrage je Seite", async () => {
    counts.clear();
    handlers.set("payments_list", list);
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, {
      queryKey: [...payments.paymentsKey(REF), "subscriptions", "account"],
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        payments.paymentsList(REF, "subscriptions", "account", pageParam),
      initialPageParam: null as string | null,
      getNextPageParam: (last: { has_more: boolean; next_cursor: string | null }) =>
        last.has_more ? last.next_cursor : undefined,
      maxPages: payments.PAYMENT_MAX_PAGES,
      ...payments.PAYMENT_QUERY_OPTIONS,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await Bun.sleep(5);
    const samples: number[] = [];
    for (let page = 1; page < PAGES; page++) {
      const started = performance.now();
      await observer.fetchNextPage();
      samples.push(performance.now() - started);
    }
    const data = observer.getCurrentResult().data;
    const retainedRows = data?.pages.reduce((sum, page) => sum + page.data.length, 0) ?? 0;
    const heapBefore = process.memoryUsage().heapUsed;
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PaymentsResourceTable, {
          reference: REF,
          resource: "subscriptions",
          scope: "account",
          actions: () => null,
        }),
      ),
    );
    const renders: number[] = [];
    for (let run = 0; run < 15; run++) {
      const started = performance.now();
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(PaymentsResourceTable, {
            reference: REF,
            resource: "subscriptions",
            scope: "account",
            actions: () => null,
          }),
        ),
      );
      renders.push(performance.now() - started);
    }
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    const result = {
      pagesFetched: PAGES,
      retainedPages: data?.pages.length,
      retainedRows,
      requests: counts.get("payments_list"),
      fetchMedianMs: percentile(samples, 0.5),
      fetchP95Ms: percentile(samples, 0.95),
      renderMedianMs: percentile(renders, 0.5),
      renderP95Ms: percentile(renders, 0.95),
      markupBytes: markup.length,
      heapDeltaBytes: heapDelta,
    };
    await reportScenario("payments-pagination", result);
    expect(result.retainedPages).toBe(payments.PAYMENT_MAX_PAGES);
    expect(retainedRows).toBe(payments.PAYMENT_MAX_PAGES * payments.PAYMENT_PAGE_LIMIT);
    expect(result.requests).toBe(PAGES);
    expect(markup.match(/<tr /g)?.length).toBe(retainedRows);
    expect(result.markupBytes).toBeLessThan(1_200_000);
    expect(result.fetchMedianMs).toBeLessThan(10);
    expect(result.fetchP95Ms).toBeLessThan(40);
    expect(result.renderMedianMs).toBeLessThan(60);
    expect(result.renderP95Ms).toBeLessThan(150);
    unsubscribe();
    client.clear();
  });

  test("keine Hintergrundabfragen im Leerlauf, bei Fokus oder Netzwechsel", async () => {
    counts.clear();
    handlers.set("payments_status", () => ({ connected: true }));
    const client = new QueryClient();
    const observer = new QueryObserver(client, {
      queryKey: [...payments.paymentsKey(REF), "status"],
      queryFn: () => payments.paymentsStatus(REF),
      ...payments.PAYMENT_QUERY_OPTIONS,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await Bun.sleep(30);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await Bun.sleep(400);
    expect(counts.get("payments_status")).toBe(1);
    unsubscribe();
    focusManager.setFocused(undefined);
    client.clear();
  });

  test("abgebrochene und veraltete Antworten werden verworfen", async () => {
    counts.clear();
    const pending = new Map<string, (value: unknown) => void>();
    handlers.set(
      "payments_list",
      (args) =>
        new Promise((resolve) => {
          pending.set(`${args?.resource}:${args?.scope}`, resolve);
        }),
    );
    const client = new QueryClient();
    const key = (resource: string) => [...payments.paymentsKey(REF), resource, "project"];
    const options = (resource: "products" | "customers") => ({
      queryKey: key(resource),
      queryFn: () => payments.paymentsList(REF, resource, "project"),
      ...payments.PAYMENT_QUERY_OPTIONS,
    });
    const observer = new QueryObserver(client, options("products"));
    const unsubscribe = observer.subscribe(() => undefined);
    await Bun.sleep(5);
    observer.setOptions(options("customers"));
    await Bun.sleep(5);
    pending.get("customers:project")?.({
      data: [{ id: "cus_new" }],
      has_more: false,
      next_cursor: null,
    });
    await Bun.sleep(5);
    pending.get("products:project")?.({
      data: [{ id: "prod_old" }],
      has_more: false,
      next_cursor: null,
    });
    await Bun.sleep(5);
    const shown = observer.getCurrentResult().data as { data: { id: string }[] };
    expect(shown.data[0]?.id).toBe("cus_new");
    unsubscribe();

    client.clear();

    const fresh = new QueryClient();
    const cancelled = new QueryObserver(fresh, options("products"));
    const stop = cancelled.subscribe(() => undefined);
    await Bun.sleep(5);
    await fresh.cancelQueries({ queryKey: key("products") });
    pending.get("products:project")?.({
      data: [{ id: "prod_late" }],
      has_more: false,
      next_cursor: null,
    });
    await Bun.sleep(20);
    expect(fresh.getQueryData(key("products"))).toBeUndefined();
    expect(counts.get("payments_list")).toBe(3);
    stop();
    fresh.clear();
  });
});
