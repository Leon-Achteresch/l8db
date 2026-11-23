import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
type Call = { command: string; kind?: string; org?: string; withBucketRetention?: boolean };
type Host = Window & {
  retentionCalls: Call[];
  releaseBucketCatalog?: () => void;
  bucketCatalogResolved?: boolean;
};
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);

afterAll(async () => {
  await browser?.close();
}, 15_000);

const retention = (page: Page) => page.locator('[data-slot="bucket-retention"]');
const picker = (page: Page) => page.getByRole("combobox", { name: "Bucket", exact: true });
const scope = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const catalogCalls = (page: Page) =>
  page.evaluate(() =>
    (window as Host).retentionCalls.filter(({ command }) => command === "list_databases"),
  );

async function fixture(hold: boolean, wide: boolean) {
  if (!url) throw Error("Missing isolated browser fixture");
  const context = await browser.newContext({
    viewport: { width: wide ? 1040 : 390, height: 700 },
    colorScheme: wide ? "light" : "dark",
    reducedMotion: "reduce",
  });
  try {
    const origin = new URL(url).origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await context.addInitScript(
      ({ hold, wide }) => {
        const host = window as Host;
        host.retentionCalls = [];
        Object.assign(host, {
          __TAURI_INTERNALS__: {
            invoke: async (
              command: string,
              args: { connectionString?: string; kind?: string; withBucketRetention?: boolean },
            ) => {
              const org = args?.connectionString
                ? (new URL(args.connectionString).searchParams.get("org") ?? undefined)
                : undefined;
              host.retentionCalls.push({
                command,
                kind: args?.kind,
                org,
                withBucketRetention: args?.withBucketRetention,
              });
              if (command === "list_schemas" || command === "sync_transactions") return ["public"];
              if (command !== "list_databases")
                throw Error(`Unexpected fixture request: ${command}`);
              if (org === "failure") throw Error("InfluxDB 403: forbidden");
              if (org === "legacy" || args.kind === "postgres") return ["metrics"];
              const entry = (name: string, seconds: number) => ({
                org_id: org,
                bucket_id: `${org}-${name}`,
                seconds,
              });
              if (org === "beta") {
                if (hold) {
                  await new Promise<void>((resolve) => {
                    host.releaseBucketCatalog = resolve;
                  });
                  host.bucketCatalogResolved = true;
                }
                return {
                  databases: ["metrics"],
                  bucket_retention: { metrics: entry("metrics", 0) },
                };
              }
              if (org === "gamma")
                return {
                  databases: ["metrics"],
                  bucket_retention: { metrics: entry("metrics", 172_800) },
                };
              const names = ["metrics", "forever", "missing", "bad"];
              if (wide) names.push(...Array.from({ length: 96 }, (_, index) => `bucket_${index}`));
              return {
                databases: names,
                bucket_retention: {
                  metrics: entry("metrics", 604_801),
                  forever: entry("forever", 0),
                  bad: entry("bad", -1),
                },
              };
            },
          },
        });
      },
      { hold, wide },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(7500);
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
        errors.push(error.message);
    });
    await page.goto(`${url}/tests/fixtures/influx-bucket-retention.html`);
    await retention(page).getByText("7 Tage, 1 Sekunde", { exact: true }).waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

run(
  "regular bucket picker shows exact duration, explicit unlimited and unknown",
  async () => {
    const { context, page, errors } = await fixture(false, false);
    try {
      const before = await catalogCalls(page);
      expect(before).toEqual([
        { command: "list_databases", kind: "influxdb", org: "alpha", withBucketRetention: true },
      ]);
      const box = await retention(page).boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      if (process.env.L8DB_INFLUX_RETENTION_SCREENSHOT) {
        await page
          .locator('[data-tour="sidebar-scope"]')
          .screenshot({ path: process.env.L8DB_INFLUX_RETENTION_SCREENSHOT });
      }
      for (const [bucket, value] of [
        ["forever", "Unbegrenzt"],
        ["missing", "Unbekannt"],
        ["bad", "Unbekannt"],
      ]) {
        await picker(page).press("Enter");
        await page.getByRole("option", { name: bucket, exact: true }).press("Enter");
        await retention(page).getByText(value, { exact: true }).waitFor();
        await picker(page).and(page.locator(":focus")).waitFor();
      }
      expect(await catalogCalls(page)).toEqual(before);
      await scope(page, "legacy").click();
      await retention(page).getByText("Unbekannt").waitFor();
      expect((await catalogCalls(page)).at(-1)?.org).toBe("legacy");
      await scope(page, "failure").click();
      await retention(page).getByText("Unbekannt").waitFor();
      expect((await catalogCalls(page)).at(-1)?.org).toBe("failure");
      await scope(page, "postgres").click();
      await page.getByRole("combobox", { name: "Datenbank" }).waitFor();
      expect(await retention(page).count()).toBe(0);
      const pg = (await catalogCalls(page)).at(-1);
      expect(pg?.kind).toBe("postgres");
      expect(pg?.withBucketRetention).toBeUndefined();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "late response and changed organization cannot relabel a same-name bucket in another context",
  async () => {
    const { context, page, errors } = await fixture(true, false);
    try {
      await scope(page, "beta").click();
      await page.waitForFunction(() => Boolean((window as Host).releaseBucketCatalog));
      expect(await retention(page).count()).toBe(0);
      await scope(page, "alpha").click();
      await retention(page).getByText("7 Tage, 1 Sekunde").waitFor();
      await page.evaluate(() => (window as Host).releaseBucketCatalog?.());
      await page.waitForFunction(() => (window as Host).bucketCatalogResolved);
      expect(await retention(page).innerText()).toContain("7 Tage, 1 Sekunde");
      expect(await retention(page).getByText("Unbegrenzt").count()).toBe(0);
      await scope(page, "beta").click();
      await retention(page).getByText("Unbegrenzt").waitFor();
      await scope(page, "Organisation ändern").click();
      await retention(page).getByText("2 Tage", { exact: true }).waitFor();
      expect((await catalogCalls(page)).map(({ org }) => org)).toEqual(["alpha", "beta", "gamma"]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "full bucket page adds a bounded passive label and no requests on picker use or idle",
  async () => {
    const { context, page, errors } = await fixture(false, true);
    try {
      const before = await page.evaluate(() => (window as Host).retentionCalls);
      const samples: number[] = [];
      for (let index = 0; index < 8; index++) {
        const elapsed = await measureAppClick(
          page,
          picker(page),
          '[role="option"][data-slot="select-item"]',
        );
        if (index > 1) samples.push(elapsed);
        expect(await page.getByRole("option").count()).toBe(100);
        await page.keyboard.press("Escape");
        await page.getByRole("listbox").waitFor({ state: "hidden" });
      }
      const latency = interactionPercentiles(samples);
      const descendants = await retention(page).locator("*").count();
      expect(descendants).toBeLessThanOrEqual(3);
      if (!process.env.CI) expect(latency.p95Ms).toBeLessThanOrEqual(250);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as Host).retentionCalls)).toEqual(before);
      expect(errors).toEqual([]);
      console.log("A45 browser", { buckets: 100, ...latency, descendants, additionalIpc: 0 });
    } finally {
      await context.close();
    }
  },
  35_000,
);
