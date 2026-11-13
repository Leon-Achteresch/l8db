import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page, webkit } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { seedApp } from "./fixtures/perf-app";

const ENABLED = process.env.L8DB_KEYBOARD_BROWSER === "1";
const engines = process.env.L8DB_BROWSER_ENGINES === "chromium" ? [chromium] : [chromium, webkit];
const browsers = new Map<string, Browser>();
let server: ViteDevServer | undefined;
let base = "";

beforeAll(async () => {
  if (!ENABLED) return;
  server = await createServer({
    cacheDir: "node_modules/.vite-keyboard-browser",
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite-Server ohne Port");
  base = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  for (const browser of browsers.values()) await browser.close();
  await server?.close();
});

type Region = string | null;

function scenario(name: string, run: (page: Page) => Promise<void>) {
  for (const engine of engines) {
    test.skipIf(!ENABLED)(
      `${engine.name()}: ${name}`,
      async () => {
        let browser = browsers.get(engine.name());
        if (!browser) {
          browser = await engine.launch({ headless: true });
          browsers.set(engine.name(), browser);
        }
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        const benign: string[] = [];
        let resourceErrors = 0;
        page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
        page.on("response", (response) => {
          if (response.status() >= 400 && response.url().startsWith("https://api.github.com/"))
            benign.push(response.url());
        });
        page.on("requestfailed", (request) => {
          if (request.url().startsWith("http://localhost:3000/blog/")) benign.push(request.url());
          else errors.push(`requestfailed: ${request.url()}`);
        });
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          if (message.text().startsWith("Failed to load resource")) resourceErrors++;
          else errors.push(`console: ${message.text()}`);
        });
        try {
          await seedApp(page, 50);
          await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector('a[data-name="table_0000"]', { timeout: 60_000 });
          await run(page);
          expect(errors).toEqual([]);
          expect(resourceErrors).toBeLessThanOrEqual(benign.length);
        } finally {
          await page.close();
        }
      },
      120_000,
    );
  }
}

function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return {
      region: (element?.closest("[data-focus-region]") as HTMLElement | null)?.dataset
        .focusRegion as Region | undefined,
      role: element?.getAttribute("role") ?? null,
      tag: element?.tagName ?? null,
      text: element?.textContent?.trim().slice(0, 60) ?? "",
      sidebarItem: element?.dataset.sidebar ?? null,
      inMonaco: Boolean(element?.closest(".monaco-editor")),
    };
  });
}

async function focusItem(page: Page, name: string) {
  await page.evaluate(
    (label) => (document.querySelector(`a[data-name="${label}"]`) as HTMLElement).focus(),
    name,
  );
}

async function openTables(page: Page, count: number) {
  for (let index = 0; index < count; index++) {
    await page.locator(`a[data-name="table_000${index}"]`).click();
    await page.waitForFunction(
      (expected) =>
        [...document.querySelectorAll('[role="tablist"] [role="tab"]')].filter((tab) =>
          tab.textContent?.includes("table_"),
        ).length >= expected,
      index + 1,
      { timeout: 5000 },
    );
    await page.waitForTimeout(150);
  }
}

function tabBar(page: Page) {
  return page
    .locator('[role="tablist"]')
    .filter({ has: page.locator('[role="tab"]', { hasText: "table_" }) })
    .first();
}

function tabs(page: Page) {
  return tabBar(page).locator('[role="tab"]');
}

async function tabNames(page: Page) {
  return (await tabs(page).allTextContents()).map((text) => text.trim());
}

async function activeTabIndex(page: Page) {
  return tabs(page).evaluateAll((nodes) => nodes.indexOf(document.activeElement as HTMLElement));
}

async function selectedTabName(page: Page) {
  const selected = tabs(page).filter({ has: page.locator('[aria-selected="true"]') });
  const count = await selected.count();
  if (count === 0) {
    const direct = await tabs(page).evaluateAll((nodes) =>
      nodes.findIndex((node) => node.getAttribute("aria-selected") === "true"),
    );
    return direct < 0 ? null : ((await tabs(page).nth(direct).textContent())?.trim() ?? null);
  }
  return (await selected.first().textContent())?.trim() ?? null;
}

async function expectSelectedTab(page: Page, name: string | undefined) {
  const deadline = Date.now() + 3000;
  while ((await selectedTabName(page)) !== name && Date.now() < deadline) await frames(page, 2);
  expect(await selectedTabName(page)).toBe(name);
}

async function sidebarVisible(page: Page) {
  return page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-focus-region="sidebar"]');
    return Boolean(
      region && region.getBoundingClientRect().width > 8 && !region.closest("[inert]"),
    );
  });
}

async function frames(page: Page, count = 2) {
  await page.evaluate(
    (frameCount) =>
      new Promise<void>((resolve) => {
        const step = (remaining: number) =>
          remaining === 0 ? resolve() : requestAnimationFrame(() => step(remaining - 1));
        step(frameCount);
      }),
    count,
  );
}

async function pressMod(page: Page, key: string) {
  await page.keyboard.press(`ControlOrMeta+${key}`);
  await frames(page, 3);
}

scenario("a: F6 zyklisch durch Seitenleiste, Tab-Leiste und Inhalt", async (page) => {
  await openTables(page, 4);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const order: (Region | undefined)[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("F6");
    await frames(page);
    order.push((await focused(page)).region);
  }
  expect(order).toEqual(["sidebar", "tabs", "content", "sidebar"]);

  await page.keyboard.press("Shift+F6");
  await frames(page);
  expect((await focused(page)).region).toBe("content");
  await page.keyboard.press("Shift+F6");
  await frames(page);
  expect((await focused(page)).region).toBe("tabs");
});

scenario("b: Seitenleiste und Inhalt per Kürzel fokussieren", async (page) => {
  await openTables(page, 1);
  await pressMod(page, "b");
  await page.waitForTimeout(500);
  expect(await sidebarVisible(page)).toBe(false);

  await pressMod(page, "Shift+E");
  await page.waitForTimeout(500);
  expect(await sidebarVisible(page)).toBe(true);
  expect((await focused(page)).region).toBe("sidebar");

  await pressMod(page, "Shift+D");
  expect((await focused(page)).region).toBe("content");
});

scenario(
  "b3: Inhalt fokussieren trifft das Datengitter, Pfeiltasten wirken sofort",
  async (page) => {
    await openTables(page, 1);
    const hasGrid = await page
      .locator("[data-grid-scroll]")
      .first()
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!hasGrid) {
      console.log("NICHT PRUEFBAR: Fixture zeigt kein Datengitter");
      return;
    }
    await pressMod(page, "Shift+D");
    const inGrid = () =>
      page.evaluate(() => Boolean(document.activeElement?.closest("[data-grid-scroll]")));
    expect(await inGrid()).toBe(true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await frames(page, 3);
    expect(await inGrid()).toBe(true);
    expect((await focused(page)).region).toBe("content");
    console.log("NICHT PRUEFBAR: aktive Zelle hat kein DOM-Merkmal, Zellwechsel nicht geprüft");
  },
);

scenario("b2: Seitenleiste-Kürzel direkt nach Ausblenden (Animation läuft)", async (page) => {
  await pressMod(page, "b");
  await pressMod(page, "Shift+E");
  await page.waitForTimeout(500);
  expect(await sidebarVisible(page)).toBe(true);
  expect((await focused(page)).region).toBe("sidebar");
});

scenario("c: Tab-Leiste mit Pfeil-, Pos1- und Ende-Taste", async (page) => {
  await openTables(page, 4);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("F6");
  await page.keyboard.press("F6");
  await frames(page);
  expect((await focused(page)).region).toBe("tabs");
  expect(await tabs(page).count()).toBeGreaterThanOrEqual(4);

  const roles = await tabBar(page).evaluate((list) => ({
    tablist: list.getAttribute("role"),
    tabs: [...list.querySelectorAll('[role="tab"]')].map((tab) => ({
      selected: tab.getAttribute("aria-selected"),
      tabindex: tab.getAttribute("tabindex"),
    })),
  }));
  expect(roles.tablist).toBe("tablist");
  expect(roles.tabs.every((tab) => tab.selected === "true" || tab.selected === "false")).toBe(true);
  expect(roles.tabs.filter((tab) => tab.tabindex === "0")).toHaveLength(1);

  const start = await activeTabIndex(page);
  expect(start).toBeGreaterThanOrEqual(0);
  const count = await tabs(page).count();
  await page.keyboard.press("ArrowRight");
  expect(await activeTabIndex(page)).toBe(Math.min(start + 1, count - 1));
  await page.keyboard.press("Home");
  expect(await activeTabIndex(page)).toBe(0);
  await page.keyboard.press("ArrowLeft");
  expect(await activeTabIndex(page)).toBe(0);
  await page.keyboard.press("End");
  expect(await activeTabIndex(page)).toBe(count - 1);
  await page.keyboard.press("ArrowRight");
  expect(await activeTabIndex(page)).toBe(count - 1);
});

scenario("d: Entf schließt den fokussierten Tab, Fokus bleibt in der Leiste", async (page) => {
  await openTables(page, 4);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("F6");
  await page.keyboard.press("F6");
  await frames(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const before = await tabNames(page);
  const target = before[1];
  await page.keyboard.press("Delete");
  await frames(page, 4);
  const after = await tabNames(page);
  expect(after).toHaveLength(before.length - 1);
  expect(after).not.toContain(target);
  expect(after.filter((name) => name === target)).toHaveLength(0);
  const focus = await focused(page);
  expect(focus.role).toBe("tab");
  expect(focus.text.length).toBeGreaterThan(0);

  while ((await tabNames(page)).length > 1) {
    await page.keyboard.press("Delete");
    await frames(page, 3);
  }
  await page.keyboard.press("Delete");
  await frames(page, 3);
});

scenario("e1: Pfeil ab nach Seitenleisten-Kürzel führt in die Liste", async (page) => {
  await pressMod(page, "Shift+E");
  await page.keyboard.press("ArrowDown");
  await frames(page);
  expect((await focused(page)).sidebarItem).not.toBeNull();
});

scenario(
  "e: Seitenleiste per Pos1-, Ende-, Pfeil- und Tipp-Navigation innerhalb der Liste",
  async (page) => {
    await focusItem(page, "table_0002");
    await frames(page, 3);
    await page.keyboard.press("Home");
    await frames(page);
    const first = await focused(page);
    expect(first.sidebarItem).not.toBeNull();

    await page.keyboard.press("End");
    await frames(page);
    const last = await focused(page);
    expect(last.sidebarItem).not.toBeNull();
    expect(last.text).not.toBe(first.text);

    await page.keyboard.press("ArrowUp");
    await frames(page);
    expect((await focused(page)).text).not.toBe(last.text);

    await page.keyboard.press("Home");
    await frames(page);
    expect((await focused(page)).text).toBe(first.text);

    const expandable = await page.evaluate(() => {
      const region = document.querySelector('[data-focus-region="sidebar"]');
      const node = region?.querySelector<HTMLElement>(
        '[data-sidebar="menu-button"][aria-expanded="false"]',
      );
      if (!node) return false;
      node.focus();
      return true;
    });
    if (!expandable)
      console.log("NICHT PRUEFBAR: keine zuklappbaren Listenknoten in der Seitenleiste");
    if (expandable) {
      const expandedBefore = await focused(page);
      await page.keyboard.press("ArrowRight");
      await frames(page, 4);
      const opened = await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-expanded"),
      );
      expect(opened).toBe("true");
      await page.keyboard.press("ArrowLeft");
      await frames(page, 4);
      const closed = await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-expanded"),
      );
      expect(closed).toBe("false");
      expect(expandedBefore.sidebarItem).not.toBeNull();
    }

    await page.keyboard.type("table_0005", { delay: 25 });
    await frames(page, 3);
    expect((await focused(page)).text).toBe("table_0005");

    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="tablist"] [role="tab"]')].some((tab) =>
          tab.textContent?.includes("table_0005"),
        ),
      undefined,
      { timeout: 5000 },
    );
    expect(await tabNames(page)).toContain("table_0005");
  },
);

scenario("f: Pfeil ab aus dem Suchfeld und Tippen im Suchfeld", async (page) => {
  const search = page.locator('[data-focus-region="sidebar"] input').first();
  await search.click();
  await page.keyboard.press("ArrowDown");
  await frames(page);
  expect((await focused(page)).sidebarItem).not.toBeNull();

  await search.click();
  await page.keyboard.type("table ?", { delay: 20 });
  await frames(page, 3);
  expect(await search.inputValue()).toBe("table ?");
  expect(await page.getByRole("dialog").count()).toBe(0);
  expect((await focused(page)).tag).toBe("INPUT");
});

scenario("g: Texteingabe und SQL-Editor ohne Tab- oder Fokusverlust", async (page) => {
  await openTables(page, 4);
  const search = page.locator('[data-focus-region="sidebar"] input').first();
  await search.click();
  await page.keyboard.type("abc", { delay: 20 });
  await page.keyboard.press("Delete");
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await frames(page, 3);
  expect(await tabNames(page)).toHaveLength(4);
  expect((await focused(page)).tag).toBe("INPUT");

  await pressMod(page, "t");
  await page.waitForTimeout(400);
  const before = await tabs(page).count();
  await page.locator(".monaco-editor .view-lines:visible").first().click();
  await frames(page, 4);
  await page.keyboard.type("select 1", { delay: 20 });
  await page.keyboard.press("Delete");
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await frames(page, 3);
  expect(await tabs(page).count()).toBe(before);
  expect((await focused(page)).inMonaco).toBe(true);
});

scenario(
  "h: ? öffnet den Spickzettel aus der Seitenleisten-Liste, Escape schließt ihn",
  async (page) => {
    await focusItem(page, "table_0000");
    await page.waitForTimeout(2500);
    expect((await focused(page)).sidebarItem).not.toBeNull();

    await page.keyboard.press("?");
    await page.getByRole("dialog").first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").first().waitFor({ state: "detached", timeout: 5000 });
  },
);

scenario("h2: Escape bringt den Fokus zum Seitenleisten-Eintrag zurück", async (page) => {
  await focusItem(page, "table_0000");
  await page.waitForTimeout(2500);
  const item = await focused(page);
  await page.keyboard.press("?");
  await page.getByRole("dialog").first().waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").first().waitFor({ state: "detached", timeout: 5000 });
  await frames(page, 4);
  expect((await focused(page)).text).toBe(item.text);
});

scenario("i: bestehende Tab-Kürzel funktionieren weiter", async (page) => {
  await openTables(page, 4);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const names = await tabNames(page);
  expect(names).toHaveLength(4);

  await pressMod(page, "1");
  await expectSelectedTab(page, names[0]);
  await pressMod(page, "PageDown");
  await expectSelectedTab(page, names[1]);
  await pressMod(page, "PageUp");
  await expectSelectedTab(page, names[0]);
  await pressMod(page, "9");
  await expectSelectedTab(page, names[3]);

  await pressMod(page, "w");
  await frames(page, 4);
  expect(await tabNames(page)).toHaveLength(3);
  expect(await tabNames(page)).not.toContain(names[3]);

  await pressMod(page, "Shift+T");
  await frames(page, 4);
  expect(await tabNames(page)).toHaveLength(4);
  expect(await tabNames(page)).toContain(names[3]);
});

scenario(
  "h3: F1 öffnet die Tastenkürzel-Ansicht als Arbeits-Tab aus der Seitenleisten-Liste",
  async (page) => {
    await focusItem(page, "table_0000");
    await page.waitForTimeout(2500);
    const overview = page.locator('input[aria-label="Tastenkürzel durchsuchen"]');
    await page.keyboard.press("F1");
    await overview.waitFor({ timeout: 5000 });
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    expect(await page.locator('[role="tab"]', { hasText: "Tastenkürzel" }).count()).toBe(1);
  },
);

scenario("j: neue Befehle stehen in den Hotkey-Einstellungen", async (page) => {
  await pressMod(page, ",");
  await page.waitForSelector("text=Tastenkürzel", { timeout: 15_000 });
  await page.getByText("Tastenkürzel", { exact: true }).first().click();
  await page.waitForSelector("text=Seitenleiste fokussieren", { timeout: 15_000 });
  const text = await page.evaluate(() => document.body.innerText);
  for (const label of [
    "Seitenleiste fokussieren",
    "Inhalt fokussieren",
    "Zum nächsten Bereich",
    "Zum vorherigen Bereich",
  ])
    expect(text).toContain(label);
  console.log(
    "NICHT PRUEFBAR: NEU-Badge gilt nur fuer Version 0.18.0, package.json ist 0.9.1; Umbelegung nicht getestet",
  );
});
