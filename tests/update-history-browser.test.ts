import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import type { QueryClient } from "@tanstack/react-query";
import { type Browser, chromium, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import type { useSettingsStore } from "../src/lib/settings";

type NativeCall = { command: string; args: Record<string, unknown> };
type TestWindow = Window & {
  updateHistoryMock: {
    calls: NativeCall[];
    listDelay: number;
    prepareDelay: number;
    listFails: boolean;
    prepareFails: boolean;
    installFails: boolean;
  };
  updateHistoryClient: QueryClient;
  updateHistorySettings: typeof useSettingsStore;
};

import { reportScenario } from "./fixtures/usage-performance";

const enabled = process.env.L8DB_UPDATE_HISTORY_BROWSER === "1";
let server: ViteDevServer;
let browser: Browser;
let base: string;

beforeAll(async () => {
  if (!enabled) return;
  server = await createServer({
    optimizeDeps: { entries: ["tests/fixtures/update-history.html"] },
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });
  await server.listen();
  base = server.resolvedUrls?.local[0] ?? "";
  if (!base) throw new Error("Test server did not start");
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function open(page: Page, channel = "stable") {
  await page.addInitScript(
    ({ channel }) => {
      const callbacks = new Map<number, (event: unknown) => void>();
      let callbackId = 0;
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      const state = {
        calls,
        listDelay: 0,
        prepareDelay: 0,
        listFails: false,
        prepareFails: false,
        installFails: false,
      };
      Object.assign(window, {
        updateHistoryMock: state,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { windowLabel: "main", label: "main" },
          },
          transformCallback(callback: (event: unknown) => void) {
            callbacks.set(++callbackId, callback);
            return callbackId;
          },
          convertFileSrc: (path: string) => path,
          async invoke(command: string, args: Record<string, unknown> = {}) {
            calls.push({ command, args });
            if (command === "list_update_releases") {
              await new Promise((resolve) => setTimeout(resolve, state.listDelay));
              if (state.listFails) throw new Error("offline");
              const page = Number(args.page);
              const versions = Array.from({ length: 100 }, (_, index) => {
                const number = 10_000 - (page - 1) * 100 - index;
                return args.channel === "canary" && index % 2
                  ? `0.18.0-canary.${number}`
                  : `0.${number}.0`;
              });
              if (page === 1) {
                versions[0] = "0.18.0-canary.100";
                versions[1] = "0.18.0-canary.99";
                versions[2] = "0.16.0";
              }
              if (args.channel === "stable" && page === 1) {
                versions[0] = "0.17.0";
                versions[1] = "0.16.1";
              }
              return { versions, nextPage: page < 100 ? page + 1 : null };
            }
            if (command === "check_update") {
              await new Promise((resolve) => setTimeout(resolve, state.prepareDelay));
              if (state.prepareFails) throw new Error("manifest unavailable");
              return {
                rid: calls.length,
                currentVersion: "0.18.0-canary.100",
                version: args.version ?? "0.19.0",
                rawJson: {},
              };
            }
            if (command === "plugin:app|version") return "0.18.0-canary.100";
            if (command === "list_transactions") return [];
            if (command === "plugin:updater|download") {
              const callback = callbacks.get(Number(args.onEvent));
              callback?.({ event: "Started", data: { contentLength: 100 } });
              callback?.({ event: "Progress", data: { chunkLength: 100 } });
              callback?.({ event: "Finished" });
              return 99;
            }
            if (command === "plugin:updater|install" && state.installFails)
              throw new Error("installer failed");
            return null;
          },
        },
      });
      localStorage.clear();
      localStorage.setItem(
        "l8db.settings",
        JSON.stringify({ state: { updateChannel: channel, autoUpdateInstall: true }, version: 1 }),
      );
    },
    { channel },
  );
  await page.goto(`${base}tests/fixtures/update-history.html`);
  await page.getByRole("button", { name: "Versionen laden" }).waitFor();
}

async function calls(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      (window as TestWindow).updateHistoryMock.calls.filter((call) => call.command === command),
    command,
  );
}

async function patch(page: Page, value: Record<string, unknown>) {
  await page.evaluate(
    (value) => Object.assign((window as TestWindow).updateHistoryMock, value),
    value,
  );
}

async function choose(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Version auswählen" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test.skipIf(!enabled)(
  "Stable/Canary history, paging, confirmation and downgrade installation",
  async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    expect(await calls(page, "list_update_releases")).toHaveLength(0);
    await page.getByRole("button", { name: "Versionen laden" }).click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "0.17.0 · Stable", exact: true }).waitFor();
    expect(await page.getByRole("option").count()).toBe(100);
    expect(await page.getByRole("option").filter({ hasText: "Canary" }).count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Canary", exact: true }).click();
    await page.getByRole("button", { name: "Versionen laden" }).click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "0.18.0-canary.99 · Canary", exact: true }).waitFor();
    expect(
      await page
        .getByRole("option", { name: "0.18.0-canary.100 · Canary · Installiert", exact: true })
        .getAttribute("data-disabled"),
    ).not.toBeNull();
    expect(await page.getByRole("option", { name: "0.16.0 · Stable", exact: true }).count()).toBe(
      1,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Ältere", exact: true }).click();
    await page.getByText("Seite 2", { exact: true }).waitFor();
    await choose(page, "0.9898.0 · Stable");
    expect((await calls(page, "list_update_releases")).at(-1).args).toMatchObject({
      channel: "canary",
      page: 2,
    });
    await page.getByRole("button", { name: "Neuere", exact: true }).click();
    await choose(page, "0.18.0-canary.99 · Canary");
    await page.getByRole("button", { name: "Version verwenden" }).click();
    await page.getByRole("region", { name: "Version 0.18.0-canary.99 ist verfügbar" }).waitFor();
    expect((await calls(page, "check_update")).at(-1).args).toEqual({
      channel: "canary",
      timeout: 20_000,
      version: "0.18.0-canary.99",
    });
    expect(await calls(page, "plugin:updater|download")).toHaveLength(0);
    expect(await page.getByText("Versionswechsel", { exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "Schließen", exact: true }).click();
    await choose(page, "0.16.0 · Stable");
    await page.getByRole("button", { name: "Version verwenden" }).click();
    await page.getByRole("region", { name: "Version 0.16.0 ist verfügbar" }).waitFor();
    await page.getByRole("button", { name: "Jetzt installieren" }).click();
    await page.waitForFunction(() =>
      (window as TestWindow).updateHistoryMock.calls.some(
        (call) => call.command === "plugin:process|restart",
      ),
    );
    const flow = await page.evaluate(() =>
      (window as TestWindow).updateHistoryMock.calls
        .map((call) => call.command)
        .filter((command: string) =>
          ["plugin:updater|download", "plugin:updater|install", "plugin:process|restart"].includes(
            command,
          ),
        ),
    );
    expect(flow).toEqual([
      "plugin:updater|download",
      "plugin:updater|install",
      "plugin:process|restart",
    ]);
    expect(
      await page.evaluate(
        () => (window as TestWindow).updateHistorySettings.getState().autoUpdateInstall,
      ),
    ).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  },
  30_000,
);

test.skipIf(!enabled)(
  "failed requests retry; abandoned selection closes its native resource",
  async () => {
    const page = await browser.newPage();
    await open(page);
    await patch(page, { listFails: true });
    await page.getByRole("button", { name: "Versionen laden" }).click();
    await page.getByRole("alert").waitFor();
    await patch(page, { listFails: false });
    await page.getByRole("button", { name: "Erneut versuchen" }).click();
    await choose(page, "0.17.0 · Stable");
    await patch(page, { prepareFails: true });
    await page.getByRole("button", { name: "Version verwenden" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Version konnte nicht geladen werden" })
      .waitFor();
    await patch(page, { prepareFails: false, prepareDelay: 200 });
    await page.getByRole("button", { name: "Version verwenden" }).click();
    await page.getByRole("button", { name: "Canary", exact: true }).click();
    await page.waitForTimeout(350);
    expect(await page.getByRole("region").count()).toBe(0);
    expect(await calls(page, "plugin:resources|close")).toHaveLength(1);
    await page.close();
  },
  20_000,
);

test.skipIf(!enabled)(
  "10,000-release history bounds DOM/cache, page latency, cancellation and idle requests",
  async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await open(page, "canary");
    await page.getByRole("button", { name: "Versionen laden" }).click();
    await page.getByRole("button", { name: "Ältere", exact: true }).waitFor({ state: "visible" });
    const timings: number[] = [];
    let maxOptions = 0;
    let maxQueries = 0;
    for (let index = 1; index < 100; index++) {
      const start = performance.now();
      await page.getByRole("button", { name: "Ältere", exact: true }).click();
      await page.waitForFunction(
        () =>
          !(document.querySelector('[aria-label="Version auswählen"]') as HTMLButtonElement)
            ?.disabled,
      );
      timings.push(performance.now() - start);
      if (index % 10 === 0 || index === 99) {
        await page.getByRole("combobox").click();
        maxOptions = Math.max(maxOptions, await page.getByRole("option").count());
        await page.keyboard.press("Escape");
        maxQueries = Math.max(
          maxQueries,
          await page.evaluate(
            () => (window as TestWindow).updateHistoryClient.getQueryCache().getAll().length,
          ),
        );
      }
    }
    timings.sort((left, right) => left - right);
    const medianMs = timings[Math.floor(timings.length / 2)];
    const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
    expect(maxOptions).toBeLessThanOrEqual(100);
    expect(maxQueries).toBeLessThanOrEqual(2);
    expect(p95Ms).toBeLessThan(500);
    expect(await page.getByRole("button", { name: "Ältere", exact: true }).isDisabled()).toBe(true);
    expect(await calls(page, "list_update_releases")).toHaveLength(100);
    await mkdir("test-artifacts/update-history", { recursive: true });
    await page.getByRole("combobox").click();
    await page.screenshot({ path: "test-artifacts/update-history/versions.png" });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 760, height: 560 });
    await page.screenshot({ path: "test-artifacts/update-history/compact.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await patch(page, { listDelay: 200 });
    await page.getByRole("button", { name: "Neuere", exact: true }).click();
    await page.getByRole("button", { name: "Stable", exact: true }).click();
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () =>
          (window as TestWindow).updateHistoryClient
            .getQueryCache()
            .getAll()
            .filter((entry) => entry.state.data).length,
      ),
    ).toBe(0);
    const idleBefore = (await calls(page, "list_update_releases")).length;
    await page.waitForTimeout(200);
    expect(await calls(page, "list_update_releases")).toHaveLength(idleBefore);
    expect(await calls(page, "execute_query")).toHaveLength(0);
    reportScenario("update-history", {
      environment: {
        os: `${platform()} ${release()}`,
        architecture: arch(),
        cpu: cpus()[0]?.model,
        ramGiB: totalmem() / 1024 ** 3,
        runtime: `Bun ${Bun.version}`,
        browser: browser.version(),
      },
      releases: 10_000,
      pages: 100,
      medianMs,
      p95Ms,
      maxOptions,
      maxQueries,
      idleRequests: 0,
      databaseRequests: 0,
      simulatedNativeTransport: true,
      limits: { p95Ms: 500, options: 100, queries: 2 },
    });
    await page.close();
  },
  120_000,
);
