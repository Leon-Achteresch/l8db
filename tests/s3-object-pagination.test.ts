import { afterEach, expect, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { type BrowserMode, objectListingOptions } from "../src/features/storage/use-object-listing";

const original = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
afterEach(() => {
  if (original) Object.defineProperty(window, "__TAURI_INTERNALS__", original);
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

function fixture(
  mode: BrowserMode,
  reply: (request: number, args: Record<string, unknown>) => unknown,
) {
  const calls: Record<string, unknown>[] = [];
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: (_cmd: string, args: Record<string, unknown>) => {
        calls.push(args);
        return reply(calls.length, args);
      },
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new InfiniteQueryObserver(
    client,
    objectListingOptions("c", "s3://test", "bucket", "", mode, ""),
  );
  return { observer, calls, client };
}

test("Versionsliste braucht einen Schlüsselmarker und erlaubt mehrere Versionen desselben Schlüssels", async () => {
  const next = [
    { next_key_marker: "k", next_version_marker: "1" },
    { next_key_marker: "k", next_version_marker: "2" },
    { next_key_marker: "weiter", next_version_marker: null },
    { next_key_marker: null, next_version_marker: "3" },
  ];
  const { observer, calls, client } = fixture("versions", (i) => ({
    prefixes: [`v${i}/`],
    versions: [],
    truncated: true,
    ...next[i - 1],
  }));
  try {
    await observer.refetch();
    while (observer.getCurrentResult().hasNextPage && calls.length < 5)
      await observer.fetchNextPage();
    expect(calls.map((c) => [c.keyMarker, c.versionMarker])).toEqual([
      [null, null],
      ["k", "1"],
      ["k", "2"],
      ["weiter", null],
    ]);
    expect(observer.getCurrentResult().data?.pages.length).toBe(4);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
  } finally {
    client.clear();
  }
});

test("ein fehlgeschlagener Folgeabruf lässt die erste Seite bestehen und kann gezielt wiederholt werden", async () => {
  const { observer, calls, client } = fixture("objects", (i) => {
    if (i === 2) throw new Error("Verbindung unterbrochen");
    return {
      prefixes: [`Seite${i}/`],
      objects: [],
      next_token: i === 1 ? "A" : null,
      truncated: i === 1,
    };
  });
  try {
    await observer.refetch();
    const failed = await observer.fetchNextPage();
    expect(failed.isFetchNextPageError).toBe(true);
    expect(failed.data?.pages[0].rows[0].key).toBe("Seite1/");
    const success = await observer.fetchNextPage({ cancelRefetch: false });
    expect(success.isError).toBe(false);
    expect(success.data?.pages.length).toBe(2);
    expect(calls.map((c) => c.continuationToken)).toEqual([null, "A", "A"]);
  } finally {
    client.clear();
  }
});

test("50.000 Objekte bleiben vollständig im Cache und ein zyklischer Marker erzeugt keine Folgeanfragen", async () => {
  const { observer, calls, client } = fixture("objects", (page) => ({
    prefixes: [],
    objects: Array.from({ length: 1000 }, (_, i) => ({ key: `p${page}/${i}`, size: 1 })),
    truncated: true,
    next_token: page === 50 ? "3" : String(page),
  }));
  try {
    await observer.refetch();
    const times: number[] = [];
    for (let i = 1; i < 50; i++) {
      const start = performance.now();
      await observer.fetchNextPage();
      times.push(performance.now() - start);
    }
    const result = observer.getCurrentResult();
    expect(result.hasNextPage).toBe(false);
    expect(result.data?.pages.reduce((n, p) => n + p.rows.length, 0)).toBe(50000);
    for (let i = 0; i < 10; i++) await observer.fetchNextPage();
    expect(calls.length).toBe(50);
    expect(observer.getCurrentResult().data?.pages.length).toBe(50);
    times.sort((a, b) => a - b);
    console.log(`S3-Seiten: Median ${times[24].toFixed(3)} ms, p95 ${times[46].toFixed(3)} ms`);
    expect(times[24]).toBeLessThan(15);
    expect(times[46]).toBeLessThan(50);
  } finally {
    client.clear();
  }
});
