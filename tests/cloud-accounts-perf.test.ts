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
import type { CloudPage, NeonProject } from "../src/lib/db/cloud-accounts";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: Object.assign(new EventTarget(), { localStorage: window.localStorage }),
});

const counts = new Map<string, number>();
const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    counts.set(command, (counts.get(command) ?? 0) + 1);
    const handler = handlers.get(command);
    return handler ? handler(args) : null;
  },
}));

const cloud = await import("../src/lib/db/cloud-accounts");
const { CloudAccountsView } = await import("../src/features/cloud-accounts/cloud-accounts-view");

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction))] ?? 0;
}

describe("Cloud-Konten Performance", () => {
  test("20 Projektseiten behalten höchstens 500 Projekte und lesen jede Seite einmal", async () => {
    counts.clear();
    handlers.set("cloud_neon_projects", (args) => {
      const page = Number(args?.cursor ?? 0);
      return {
        items: Array.from({ length: 100 }, (_, index) => ({
          id: `project-${page * 100 + index}`,
          name: `Projekt ${page * 100 + index}`,
        })),
        next_cursor: page < 19 ? String(page + 1) : null,
      };
    });
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, {
      queryKey: ["cloud-accounts", "pagination"],
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        cloud.neonProjects("acc", { cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (last: CloudPage<NeonProject>) => last.next_cursor ?? undefined,
      ...cloud.CLOUD_INFINITE_QUERY_OPTIONS,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch({ cancelRefetch: false });
    const samples: number[] = [];
    for (let page = 1; page < 20; page++) {
      const started = performance.now();
      await observer.fetchNextPage();
      samples.push(performance.now() - started);
    }
    const data = observer.getCurrentResult().data;
    const rows = data?.pages.reduce((sum, page) => sum + page.items.length, 0);
    console.log(
      JSON.stringify({
        feature: "cloud-project-pagination",
        pages: 20,
        retainedPages: data?.pages.length,
        retainedRows: rows,
        requests: counts.get("cloud_neon_projects"),
        medianMs: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
      }),
    );
    expect(data?.pages.length).toBe(cloud.CLOUD_MAX_PAGES);
    expect(rows).toBe(500);
    expect(counts.get("cloud_neon_projects")).toBe(20);
    expect(percentile(samples, 0.5)).toBeLessThan(10);
    expect(percentile(samples, 0.95)).toBeLessThan(40);
    unsubscribe();
    client.clear();
  });

  test("keine Hintergrundabfragen im Leerlauf, bei Fokus oder Netzwechsel", async () => {
    counts.clear();
    handlers.set("cloud_accounts", () => []);
    const client = new QueryClient();
    const observer = new QueryObserver(client, {
      queryKey: ["cloud-accounts", "list"],
      queryFn: cloud.cloudAccounts,
      ...cloud.CLOUD_QUERY_OPTIONS,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await Bun.sleep(50);
    expect(counts.get("cloud_accounts")).toBe(1);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await Bun.sleep(400);
    expect(counts.get("cloud_accounts")).toBe(1);
    unsubscribe();
    focusManager.setFocused(undefined);
    client.clear();
  });

  test("veraltete Antworten werden nach einem Wechsel nicht angewendet", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    handlers.set(
      "cloud_neon_projects",
      (args) =>
        new Promise((resolve) => {
          pending.set(String(args?.search), resolve);
        }),
    );
    const client = new QueryClient();
    const options = (search: string) => ({
      queryKey: ["cloud-accounts", "acc", "neon", "projects", search],
      queryFn: () => cloud.neonProjects("acc", { search }),
      ...cloud.CLOUD_QUERY_OPTIONS,
    });
    const observer = new QueryObserver(client, options("alt"));
    const unsubscribe = observer.subscribe(() => undefined);
    await Bun.sleep(10);
    observer.setOptions(options("neu"));
    await Bun.sleep(10);
    pending.get("neu")?.({ items: [{ id: "p-neu", name: "Neu" }], next_cursor: null });
    await Bun.sleep(10);
    pending.get("alt")?.({ items: [{ id: "p-alt", name: "Alt" }], next_cursor: null });
    await Bun.sleep(10);
    const data = observer.getCurrentResult().data as { items: { name: string }[] };
    expect(data.items[0]?.name).toBe("Neu");
    unsubscribe();
    client.clear();
  });

  test("Kontoansicht mit 50 Konten und 100 Projekten rendert schnell und begrenzt", () => {
    counts.clear();
    const accounts = Array.from({ length: 50 }, (_, index) => ({
      id: `acc-${index}`,
      provider: (["neon", "planetscale", "spacetimedb"] as const)[index % 3],
      label: `Konto ${index}`,
      auth: "api_key" as const,
      endpoint: null,
      identity: null,
      created_at: "2026-11-01T00:00:00Z",
    }));
    const projects = Array.from({ length: 100 }, (_, index) => ({
      id: `p-${index}`,
      name: `Projekt mit einem längeren Namen ${index}`,
      region_id: "aws-eu-central-1",
      pg_version: 17,
      org_id: null,
      created_at: null,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    client.setQueryData(["cloud-accounts", "list"], accounts);
    client.setQueryData(["cloud-accounts", "acc-0", "neon", "organizations"], []);
    client.setQueryData(["cloud-accounts", "acc-0", "neon", "projects", null, ""], {
      pages: [{ items: projects, next_cursor: "p-99" }],
      pageParams: [null],
    });
    const render = () =>
      renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, createElement(CloudAccountsView)),
      );
    const markup = render();
    expect(markup).toContain("Projekt mit einem längeren Namen 99");
    expect(markup).toContain("Mehr laden");
    expect((markup.match(/<li/g) ?? []).length).toBeLessThanOrEqual(100);
    const samples: number[] = [];
    for (let index = 0; index < 60; index++) {
      const started = performance.now();
      render();
      samples.push(performance.now() - started);
    }
    const median = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    console.log(
      `cloud-accounts view 50 accounts/100 projects: median ${median.toFixed(2)}ms p95 ${p95.toFixed(2)}ms, ${markup.length} bytes`,
    );
    expect(median).toBeLessThan(40);
    expect(p95).toBeLessThan(90);
    expect([...counts.values()].reduce((sum, value) => sum + value, 0)).toBe(0);
    client.clear();
  });
});
