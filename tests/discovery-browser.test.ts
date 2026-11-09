import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright";
import { ROADMAP_URL } from "../src/lib/discovery/roadmap/model";
import { ASSET_BASE, FEED_URL } from "../src/lib/feature-videos/model";
import { DURATION_BUCKETS } from "../src/lib/usage-statistics";
import { seedUiPluginApp, serveBuiltApp } from "./fixtures/ui-plugins-app";

const enabled = Boolean(process.env.L8DB_DISCOVERY_BROWSER);
const SHOTS = resolve(process.env.L8DB_DISCOVERY_SHOTS ?? "test-artifacts/discovery-browser");
const VERSION = "0.18.0";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const HARMLESS = [/Failed to load resource: the server responded with a status of 404/];
const DAY = 86_400_000;
const CHANNELS = [
  "promoter",
  "waitTips",
  "hotspots",
  "spotlight",
  "welcomeBack",
  "feedback",
  "related",
  "teamTips",
  "recap",
  "achievements",
  "videoTooltips",
];

type Seeds = Record<string, unknown>;

interface Boot {
  path: string;
  seeds?: Seeds;
  settings?: Record<string, unknown>;
  channels?: Record<string, boolean>;
  queryDelayMs?: number;
  teamTips?: unknown[];
  now?: number;
  dark?: boolean;
  hotspots?: boolean;
  ai?: boolean;
}

interface Session {
  page: Page;
  errors: string[];
}

let browser: Browser;
let server: ReturnType<typeof serveBuiltApp>;
let poster: Buffer;
let clip: Buffer | null = null;
let current: Page | null = null;

const persisted = (state: unknown, version = 1) => ({ state, version });

const usage = (ids: Record<string, number>, at = Date.now()) =>
  persisted({
    usage: Object.fromEntries(
      Object.entries(ids).map(([id, count]) => [
        id,
        { count, first: at - 30 * DAY, last: at - DAY },
      ]),
    ),
  });

const videoItem = (id: string, title: string, now: number) => ({
  id,
  revision: "1",
  title,
  summary: `${title} in zwölf Sekunden.`,
  releaseVersion: "0.17.0",
  minAppVersion: "0.17.0",
  sourceCommit: "3b45ffb5",
  publishedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + DAY).toISOString(),
  priority: 50,
  platforms: ["macos", "windows", "linux"],
  modes: ["easy", "normal"],
  requiredCapabilities: [],
  actionId: "settings",
  durationSeconds: 12,
  poster: `${ASSET_BASE}feature-video-${id}-1/fv-${id}-1.jpg`,
  sources: [
    {
      url: `${ASSET_BASE}feature-video-${id}-1/fv-${id}-1.webm`,
      type: "video/webm",
      bytes: 40_000,
    },
    {
      url: `${ASSET_BASE}feature-video-${id}-1/fv-${id}-1.mp4`,
      type: "video/mp4",
      bytes: 40_000,
    },
  ],
});

function videoFeed(now: number) {
  return {
    schemaVersion: 1,
    generatedAt: new Date(now - 1000).toISOString(),
    validUntil: new Date(now + DAY).toISOString(),
    items: [
      videoItem("dashboard-workspace", "Dashboards bauen", now),
      videoItem("easy-mode", "Mehr Ruhe mit Easy Mode", now),
      videoItem("split-dnd", "Ansichten teilen", now),
    ],
  };
}

const ROADMAP = {
  schemaVersion: 1,
  items: [
    {
      id: "oracle-plaene",
      title: "Ausführungspläne für Oracle",
      summary: "EXPLAIN PLAN direkt im Editor, mit Kosten pro Schritt.",
      status: "in-arbeit",
      issue: 412,
      votes: 38,
      eta: "Q1 2027",
    },
    {
      id: "notebook-teilen",
      title: "Notebooks im Team teilen",
      summary: "Notebooks über die Team-Datei verteilen und gemeinsam pflegen.",
      status: "geplant",
      issue: 398,
      votes: 21,
    },
    {
      id: "mongo-aggregation",
      title: "Aggregation-Builder für MongoDB",
      summary: "Pipelines Schritt für Schritt zusammenklicken und Zwischenergebnisse sehen.",
      status: "geplant",
      issue: 377,
      votes: 17,
      eta: "2027",
    },
    {
      id: "spickzettel",
      title: "Spickzettel mit ?",
      summary: "Kürzel und Funktionen der aktuellen Ansicht auf einen Blick.",
      status: "erschienen",
      votes: 9,
    },
    {
      id: "erd-export-svg",
      title: "ER-Diagramm als SVG",
      summary: "Diagramme verlustfrei für Doku und Wikis exportieren.",
      status: "in-arbeit",
      issue: 365,
      votes: 12,
    },
  ],
};

function statisticsSeed(now: number) {
  const histogram = (values: Record<number, number>) =>
    Array.from({ length: DURATION_BUCKETS.length + 1 }, (_, index) => values[index] ?? 0);
  return {
    version: 1,
    epoch: "",
    data: {
      sessionCount: 1,
      startedAt: now - 300 * DAY,
      updatedAt: now - DAY,
      views: [],
      transitions: [],
      operations: [
        {
          operation: "user-query",
          kind: "postgres",
          ok: 1834,
          error: 41,
          cancelled: 6,
          totalMs: 1_204_000,
          histogram: histogram({ 4: 900, 6: 700, 8: 230, 10: 45, 12: 6 }),
        },
        {
          operation: "query",
          kind: "sqlite",
          ok: 412,
          error: 3,
          cancelled: 0,
          totalMs: 61_000,
          histogram: histogram({ 2: 300, 4: 115 }),
        },
        {
          operation: "export",
          kind: "postgres",
          ok: 57,
          error: 1,
          cancelled: 0,
          totalMs: 98_000,
          histogram: histogram({ 8: 40, 10: 18 }),
        },
      ],
      startup: { count: 211, totalMs: 190_000, histogram: histogram({ 8: 150, 9: 61 }) },
    },
  };
}

function recapDays(now: number) {
  const days: Record<string, number> = {};
  for (let index = 1; index < 330; index += index % 7 === 3 ? 2 : 1) {
    const date = new Date(now - index * DAY);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    days[key] = 3 + ((index * 37) % 41);
  }
  return persisted({ days, longest: { year: 2026, ms: 418_000 }, offeredYear: 2026 });
}

async function makePoster(): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.setContent(
    `<body style="margin:0;background:linear-gradient(135deg,#1e293b,#4f46e5);font:600 34px system-ui;color:white;display:grid;place-items:center;height:100vh">Dashboards</body>`,
  );
  const image = await page.screenshot({ type: "jpeg", quality: 80 });
  await page.close();
  return image;
}

async function boot(options: Boot): Promise<Session> {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: options.dark ? "dark" : "light",
  });
  page.setDefaultTimeout(15_000);
  current = page;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!HARMLESS.some((pattern) => pattern.test(text))) errors.push(`console: ${text}`);
  });
  const now = options.now ?? Date.now();
  await page.addInitScript((initial: number) => {
    const Real = Date;
    let shift = initial;
    class Shifted extends Real {
      constructor(...args: unknown[]) {
        if (args.length) super(...(args as [number]));
        else super(Real.now() + shift);
      }
      static now() {
        return Real.now() + shift;
      }
    }
    Object.assign(window, {
      Date: Shifted,
      discoveryShift: (ms: number) => {
        shift += ms;
      },
    });
  }, now - Date.now());
  const channels = Object.fromEntries(CHANNELS.map((id) => [id, id !== "achievements"]));
  await seedUiPluginApp(
    page,
    {},
    {
      environment: null,
      settings: {
        theme: options.dark ? "dark" : "light",
        blogSuggestions: false,
        discovery: { enabled: true, channels: { ...channels, ...options.channels }, labs: {} },
        ...options.settings,
      },
    },
  );
  const feed = videoFeed(now);
  const seeds: Seeds = {
    "l8db.discovery.spotlight": persisted({ seenVersion: VERSION, lastActive: now - DAY }),
    "l8db.feature-videos": {
      state: {
        feed: null,
        checkedAt: 0,
        history: Object.fromEntries(
          feed.items.map((item) => [item.id, { status: "dismissed", at: now - DAY }]),
        ),
      },
    },
    ...(options.hotspots
      ? {}
      : {
          "l8db.discovery.hotspots": persisted({
            dismissed: ["discover", "discover.atlas", "discover.lessons", "discover.guide"],
          }),
        }),
    ...options.seeds,
  };
  await page.addInitScript(
    ({ seeds, version, delay, teamTips, ai }) => {
      if (!sessionStorage.getItem("discovery-seeded")) {
        sessionStorage.setItem("discovery-seeded", "1");
        for (const [key, value] of Object.entries(seeds))
          localStorage.setItem(key, JSON.stringify(value));
      }
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const base = internals.invoke;
      const sql: string[] = [];
      Object.assign(window, { discoverySql: sql });
      const rows = Array.from({ length: 24 }, (_, index) => ({
        id: 10_480 + index,
        customer: ["Müller Logistik GmbH", "Nordlicht Media", "Alpenblick Hotels"][index % 3],
        total: (120 + index * 17.5).toFixed(2),
      }));
      internals.invoke = async (command, args = {}) => {
        if (ai && command.startsWith("ai_")) {
          if (command === "ai_environment") return { cwd: "/tmp/ai-fixture" };
          if (command === "ai_status")
            return {
              provider: (args.profile as { provider?: string } | undefined)?.provider,
              installed: true,
              version: "fixture",
              keyStored: true,
            };
          if (command === "ai_models")
            return {
              models: [{ id: "fixture", name: "Fixture", efforts: [], fast: true, default: true }],
              modes: { availableModes: [] },
              configOptions: [],
            };
          if (command === "ai_run") {
            const events = args.events as { onmessage: (event: unknown) => void };
            events.onmessage({ kind: "session", data: { sessionId: "discovery" } });
            events.onmessage({
              kind: "text",
              data: {
                delta:
                  "Dafür gibt es den Schema-Vergleich: zwei Schemas nebeneinander, Unterschiede markiert, Abgleichsskript auf Knopfdruck.\n\n```feature\nschema-compare\n```",
              },
            });
            return;
          }
          return [];
        }
        switch (command) {
          case "plugin:app|version":
            return version;
          case "list_tables":
            if (args.kind === "sqlite")
              return ["customers", "orders", "order_items", "products"].map((name) => ({
                schema: String(args.schema ?? "main"),
                name,
              }));
            return base(command, args);
          case "plugin:path|resolve_directory":
            return "/tmp";
          case "team_connections":
            return teamTips
              ? {
                  path: "/Users/demo/.l8db/connections.json",
                  exists: true,
                  connections: [],
                  tips: teamTips,
                  warnings: [],
                }
              : { path: "/Users/demo/.l8db/connections.json", exists: false, connections: [] };
          case "execute_query": {
            const text = String(args.sql ?? "");
            sql.push(text);
            if (/^\s*(create|insert|drop|delete|begin|commit|pragma)/i.test(text))
              return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 1 };
            if (delay) await new Promise((done) => setTimeout(done, delay));
            return {
              columns: ["id", "customer", "total"],
              rows,
              rows_affected: rows.length,
              execution_time_ms: delay || 12,
            };
          }
          default:
            return base(command, args);
        }
      };
    },
    {
      seeds,
      version: VERSION,
      delay: options.queryDelayMs ?? 0,
      teamTips: options.teamTips ?? null,
      ai: options.ai === true,
    },
  );
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      json: { tag_name: "feature-videos", draft: false, body: JSON.stringify(feed) },
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.route(`${ASSET_BASE}**`, (route) => {
    const url = route.request().url();
    if (url.endsWith(".jpg"))
      return route.fulfill({
        body: poster,
        contentType: "image/jpeg",
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (clip)
      return route.fulfill({
        body: clip,
        contentType: "video/webm",
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    return route.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.route(ROADMAP_URL, (route) =>
    route.fulfill({
      json: { tag_name: "roadmap", draft: false, prerelease: true, body: JSON.stringify(ROADMAP) },
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  const hosts = Promise.all(
    ["promoter-host", "related-host", "feedback-host", "achievements-host"].map((name) =>
      page.waitForResponse(
        (response) =>
          /\/(promoter|related|feedback|achievements)-host[-.]/.test(response.url()) &&
          response.url().includes(name),
      ),
    ),
  );
  await page.goto(`http://localhost:${server.port}${options.path}`);
  await hosts;
  await page.waitForTimeout(300);
  await page.waitForFunction(() => document.fonts.status === "loaded");
  return { page, errors };
}

async function quietGate(page: Page, shiftMs = 6 * 60_000) {
  await page.mouse.move(1430, 890);
  await page.evaluate(
    (shift) =>
      (window as unknown as { discoveryShift: (ms: number) => void }).discoveryShift(shift),
    shiftMs,
  );
  await page.waitForTimeout(5_500);
}

async function shoot(session: Session, name: string, target?: Locator | Locator[], margin = 24) {
  const { page } = session;
  await page.waitForTimeout(450);
  const path = resolve(SHOTS, `${name}.png`);
  const targets = target === undefined ? [] : Array.isArray(target) ? target : [target];
  if (targets.length === 0) {
    await page.screenshot({ path, animations: "disabled" });
  } else {
    const boxes = await Promise.all(targets.map((item) => item.boundingBox()));
    if (boxes.some((box) => !box)) throw new Error(`${name}: kein sichtbarer Bereich`);
    const valid = boxes as { x: number; y: number; width: number; height: number }[];
    const left = Math.max(0, Math.min(...valid.map((box) => box.x)) - margin);
    const top = Math.max(0, Math.min(...valid.map((box) => box.y)) - margin);
    const right = Math.min(1440, Math.max(...valid.map((box) => box.x + box.width)) + margin);
    const bottom = Math.min(900, Math.max(...valid.map((box) => box.y + box.height)) + margin);
    await page.screenshot({
      path,
      animations: "disabled",
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    });
  }
  expect(session.errors).toEqual([]);
  await page.close();
}

async function runQuery(page: Page, text: string) {
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
}

const scenario = (name: string, run: () => Promise<void>, timeout = 90_000) =>
  test.skipIf(!enabled)(
    name,
    async () => {
      try {
        await run();
      } catch (error) {
        if (current && !current.isClosed())
          await current.screenshot({ path: resolve(SHOTS, `failed-${name.split(" ")[0]}.png`) });
        throw error;
      } finally {
        if (current && !current.isClosed()) await current.close();
      }
    },
    timeout,
  );

beforeAll(async () => {
  if (!enabled) return;
  await mkdir(SHOTS, { recursive: true });
  server = serveBuiltApp();
  browser = await chromium.launch();
  poster = await makePoster();
  try {
    const file = resolve(SHOTS, "clip.webm");
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-t",
      "4",
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "120k",
      file,
    ]);
    clip = await readFile(file);
  } catch {
    clip = null;
  }
}, 60_000);

afterAll(async () => {
  if (!enabled) return;
  await browser?.close();
  server?.stop(true);
});

scenario("A1 Feature-Promoter schlägt nach dreimal gleicher Abfrage Snippets vor", async () => {
  const session = await boot({ path: "/query" });
  const { page } = session;
  for (let run = 0; run < 3; run++) {
    await runQuery(page, "SELECT id, customer, total FROM sales.orders");
    await page.getByText("Müller Logistik GmbH").first().waitFor();
  }
  await quietGate(page);
  const card = page.getByRole("status").filter({ hasText: "Dieselbe Abfrage dreimal ausgeführt" });
  await card.waitFor();
  await card.getByRole("button", { name: "Zeigen" }).waitFor();
  await shoot(session, "01-promoter", card);
});

scenario("A2 Tipps beim Warten erscheinen bei langer Abfrage", async () => {
  const session = await boot({ path: "/query", queryDelayMs: 4_000 });
  const { page } = session;
  await runQuery(page, "SELECT id, customer, total FROM sales.orders");
  const tip = page.locator('p[role="status"]').filter({ hasText: /\S/ });
  await tip.waitFor({ timeout: 3_500 });
  await shoot(session, "02-wait-tips", [tip, page.getByText("Ausführen…")], 48);
});

scenario("A3 Modifier halten zeigt Kürzel auf Buttons", async () => {
  const session = await boot({ path: "/query" });
  const { page } = session;
  await page.mouse.move(700, 400);
  await page.keyboard.down(MOD);
  await page.waitForTimeout(800);
  const badges = page.locator("[data-modifier-overlay] kbd");
  await badges.first().waitFor();
  expect(await badges.count()).toBeGreaterThan(3);
  await shoot(session, "03-modifier-overlay");
});

scenario("A4 Video-Tooltip zeigt Clip am Button", async () => {
  const session = await boot({ path: "/query" });
  const { page } = session;
  const anchor = page.locator('[data-feature="dashboard"]').first();
  await anchor.waitFor();
  await page.waitForTimeout(800);
  await anchor.hover();
  const card = page.locator("[data-video-tooltip]");
  await card.waitFor();
  await card.locator("img, video").first().waitFor();
  await shoot(session, "04-video-tooltip", [card, anchor]);
});

scenario("A5 Lehrender leerer Zustand mit Aktion", async () => {
  const session = await boot({ path: "/query" });
  const { page } = session;
  await page
    .getByRole("tab", { name: "Queries" })
    .or(page.getByRole("button", { name: "Queries" }))
    .first()
    .click();
  const empty = page.locator("[data-empty-state]").first();
  await empty.waitFor();
  await empty.getByRole("button").first().waitFor();
  await shoot(session, "05-empty-state", empty, 48);
});

scenario("B1 Feature-Atlas mit Fortschritt", async () => {
  const session = await boot({
    path: "/discover?tab=atlas",
    seeds: {
      "l8db.discovery.usage": usage({
        "query.run": 140,
        "query.format": 22,
        "table.filter-bar": 31,
        "er-diagram": 4,
        dashboard: 9,
        "query.history": 12,
        explain: 3,
      }),
    },
  });
  const { page } = session;
  await page.getByRole("radiogroup", { name: "Filter" }).waitFor();
  await page.getByRole("group", { name: "Funktionen" }).waitFor();
  await shoot(session, "06-atlas");
});

scenario("B2 Was ist das? erklärt ein angeklicktes Element", async () => {
  const session = await boot({ path: "/discover" });
  const { page } = session;
  const target = page.getByRole("tab", { name: "Atlas" });
  await target.waitFor();
  await page.keyboard.press(`${MOD}+Shift+H`);
  await page.waitForTimeout(400);
  await target.click();
  const popover = page.getByRole("dialog", { name: "Was ist das?" });
  await popover.waitFor();
  await popover.getByText("Feature-Atlas").first().waitFor();
  await shoot(session, "07-whats-this", [popover, target]);
});

scenario("B3 Palette erklärt sich", async () => {
  const session = await boot({ path: "/query" });
  const { page } = session;
  await page.mouse.click(1000, 600);
  await page.keyboard.press(`${MOD}+K`);
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor();
  await page.getByPlaceholder("Suchen… · > für Befehle").fill("notebook");
  await dialog.getByRole("option").first().waitFor();
  await shoot(session, "08-palette", dialog);
});

scenario("B4 KI-Feature-Suche lokal in der Palette", async () => {
  const session = await boot({ path: "/query" });
  const { page } = session;
  await page.mouse.click(1000, 600);
  await page.keyboard.press(`${MOD}+K`);
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor();
  await page.getByPlaceholder("Suchen… · > für Befehle").fill("wie vergleiche ich zwei schemas");
  await dialog.getByRole("option").filter({ hasText: "Schema-Vergleich" }).first().waitFor();
  await shoot(session, "09-feature-search-palette", dialog);
});

scenario("B4 KI-Feature-Suche im KI-Chat zeigt Feature-Karte", async () => {
  const session = await boot({ path: "/query", ai: true });
  const { page } = session;
  await page.getByRole("button", { name: "AI-Arbeitsbereich", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI-Arbeitsbereich", exact: true });
  await panel.waitFor();
  const input = panel.getByRole("textbox").first();
  await input.click();
  await page.keyboard.insertText("Wie vergleiche ich zwei Schemas?");
  await page.keyboard.press("Enter");
  const show = panel.getByRole("button", { name: "Zeigen" }).first();
  await show.waitFor();
  await shoot(session, "10-feature-search-chat", panel, 0);
});

scenario("B5 Spickzettel mit ?", async () => {
  const session = await boot({ path: "/query" });
  const { page } = session;
  await page.mouse.click(1000, 600);
  await page.keyboard.press("?");
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("Spickzettel durchsuchen") });
  await dialog.waitFor();
  await dialog.getByRole("region", { name: "Kürzel hier" }).waitFor();
  await shoot(session, "11-cheatsheet");
});

scenario("C1 Release-Spotlight nach Update", async () => {
  const session = await boot({
    path: "/query",
    seeds: {
      "l8db.discovery.spotlight": persisted({
        seenVersion: "0.17.0",
        lastActive: Date.now() - DAY,
      }),
    },
  });
  const { page } = session;
  await quietGate(page);
  const dialog = page.locator('[data-discovery-spotlight="spotlight"]');
  await dialog.waitFor();
  await dialog.getByText("Neu in 0.18").waitFor();
  await shoot(session, "12-release-spotlight");
});

scenario("C1 Release-Spotlight folgt dem App-Theme", async () => {
  for (const [name, dark, settings] of [
    ["30-spotlight-grove", true, { darkTheme: "grove", dbThemes: false }],
    ["31-spotlight-ember", false, { lightTheme: "ember", dbThemes: false }],
  ] as const) {
    const session = await boot({
      path: "/query",
      dark,
      settings,
      seeds: {
        "l8db.discovery.spotlight": persisted({
          seenVersion: "0.17.0",
          lastActive: Date.now() - DAY,
        }),
      },
    });
    await quietGate(session.page);
    await session.page.locator('[data-discovery-spotlight="spotlight"]').waitFor();
    await shoot(session, name);
  }
});

scenario("C2 Willkommen zurück nach übersprungenen Versionen", async () => {
  const session = await boot({
    path: "/query",
    seeds: {
      "l8db.discovery.spotlight": persisted({
        seenVersion: "0.14.0",
        lastActive: Date.now() - 40 * DAY,
      }),
    },
  });
  const { page } = session;
  await quietGate(page);
  const dialog = page.locator('[data-discovery-spotlight="welcomeBack"]');
  await dialog.waitFor();
  await dialog.getByText(/Willkommen zurück/).waitFor();
  await shoot(session, "13-welcome-back");
});

scenario("C3 Lektion mit Demo-Datenbank", async () => {
  const session = await boot({ path: "/discover?tab=lessons" });
  const { page } = session;
  await page.getByRole("button", { name: "Lektion starten" }).first().click();
  const bubble = page.getByRole("dialog", { name: "Zeig's mir" }).filter({ hasText: "2/2" });
  await bubble.waitFor();
  await bubble.getByText("Abfrage ausführen").waitFor();
  await page.getByText("Demo-Shop").first().waitFor();
  await page.waitForTimeout(1_000);
  await shoot(session, "14-lessons");
});

scenario("C4 Zeig's mir führt mit Geister-Cursor", async () => {
  const session = await boot({ path: "/discover" });
  const { page } = session;
  await page.getByRole("button", { name: "Zeig's mir", exact: true }).first().click();
  const bubble = page.getByRole("dialog", { name: "Zeig's mir" });
  await bubble.waitFor();
  await page.waitForTimeout(1_200);
  await shoot(session, "15-guide");
});

scenario("C5 Hotspot-Puls an neuem Feature", async () => {
  const session = await boot({ path: "/query", hotspots: true });
  const { page } = session;
  const dot = page.locator('[aria-label^="Neu: "]').first();
  await dot.waitFor();
  await shoot(session, "16-hotspot", dot, 70);
});

scenario("D1 Labs in den Einstellungen", async () => {
  const session = await boot({ path: "/settings?tab=discovery" });
  const { page } = session;
  const heading = page.getByText("Labs", { exact: true }).first();
  await heading.waitFor();
  await heading.scrollIntoViewIfNeeded();
  const section = page
    .locator("section, div")
    .filter({ has: heading })
    .filter({ has: page.getByTitle("Feedback") })
    .last();
  await section.waitFor();
  await shoot(session, "17-labs", section);
});

scenario("D2 Roadmap aus dem Feed", async () => {
  const session = await boot({ path: "/discover?tab=roadmap" });
  const { page } = session;
  await page.getByText("Ausführungspläne für Oracle").waitFor();
  await shoot(session, "18-roadmap");
});

scenario("D3 Mikro-Feedback nach dritter Nutzung", async () => {
  const session = await boot({
    path: "/discover",
    seeds: {
      "l8db.discovery.usage": usage({
        "discover.atlas": 2,
        "discover.guide": 1,
        "discover.lessons": 1,
      }),
    },
  });
  const { page } = session;
  await page.getByRole("tab", { name: "Atlas" }).click();
  await quietGate(page);
  const card = page
    .getByRole("status")
    .filter({ has: page.getByRole("button", { name: "Gefällt mir", exact: true }) });
  await card.waitFor();
  await shoot(session, "19-feedback", card);
});

scenario("D4 Passt dazu schlägt verwandtes Feature vor", async () => {
  const session = await boot({ path: "/discover" });
  const { page } = session;
  await page.waitForTimeout(4_000);
  await page.getByRole("tab", { name: "Atlas" }).click();
  await quietGate(page, 293_000);
  const card = page.getByRole("status").filter({ hasText: "Zeig's mir" });
  await card.waitFor();
  await shoot(session, "20-related", card);
});

const TEAM_TIPS = [
  {
    id: "explain-zuerst",
    title: "Langsame Abfrage? Erst Explain",
    body: "Bevor ihr Indizes anlegt: Plan ansehen und im Team-Kanal teilen.",
    featureId: "explain",
  },
  {
    id: "prod-readonly",
    title: "Produktion nur lesend",
    body: "Schreibende Statements bitte über Automatisierung mit Review.",
  },
];

scenario("D5 Team-Tipps über den Koordinator", async () => {
  const session = await boot({ path: "/query", teamTips: TEAM_TIPS });
  const { page } = session;
  await quietGate(page);
  const card = page.locator("[data-discovery-note]").filter({ hasText: "Tipp vom Team" });
  await card.waitFor();
  await shoot(session, "21-team-tips", card);
});

scenario("D5 Team-Tipps im Entdecken-Tab", async () => {
  const session = await boot({ path: "/discover?tab=team", teamTips: TEAM_TIPS });
  const { page } = session;
  await page.getByText("Produktion nur lesend").waitFor();
  await shoot(session, "22-team-tab");
});

const DECEMBER = new Date(2026, 11, 10, 10, 0, 0).getTime();

function recapSeeds(offered: boolean) {
  const days = recapDays(DECEMBER);
  return {
    "l8db.usage-statistics.session.discovery": statisticsSeed(DECEMBER),
    "l8db.discovery.recap": persisted({
      ...(days.state as Record<string, unknown>),
      offeredYear: offered ? 2026 : null,
    }),
    "l8db.discovery.usage": usage(
      {
        "query.run": 1834,
        "query.format": 211,
        "table.filter-bar": 402,
        "er-diagram": 18,
        dashboard: 47,
        "query.history": 96,
        explain: 31,
        transfer: 5,
      },
      DECEMBER,
    ),
  };
}

scenario("E1 Jahresrückblick-Angebot im Dezember", async () => {
  const session = await boot({
    path: "/query",
    now: DECEMBER,
    settings: { localUsageStats: true },
    seeds: recapSeeds(false),
  });
  const { page } = session;
  await quietGate(page);
  const card = page.locator("[data-discovery-note]").filter({ hasText: "Dein l8db-Jahr 2026" });
  await card.waitFor();
  await shoot(session, "23-recap-offer", card);
});

scenario("E1 Jahresrückblick-Tab aus lokalen Daten", async () => {
  const session = await boot({
    path: "/discover?tab=recap",
    now: DECEMBER,
    settings: { localUsageStats: true },
    seeds: recapSeeds(true),
  });
  const { page } = session;
  await page.getByText("Noch nie ausprobiert").waitFor();
  await page.getByText("Meistgenutzt").waitFor();
  await shoot(session, "24-recap");
});

scenario("E2 Erfolge", async () => {
  const session = await boot({
    path: "/discover?tab=achievements",
    channels: { achievements: true },
    seeds: {
      "l8db.discovery.usage": usage({
        "query.run": 120,
        "query.format": 14,
        "table.filter-bar": 30,
        "er-diagram": 3,
        dashboard: 6,
      }),
    },
  });
  const { page } = session;
  await page.getByRole("switch", { name: "Erfolge sammeln" }).waitFor();
  await page.waitForTimeout(800);
  await shoot(session, "25-achievements");
});

scenario(
  "Dunkel: Atlas, Spickzettel, Roadmap, Spotlight",
  async () => {
    const atlas = await boot({ path: "/discover?tab=atlas", dark: true });
    await atlas.page.getByRole("group", { name: "Funktionen" }).waitFor();
    await shoot(atlas, "26-dark-atlas");
    const roadmap = await boot({ path: "/discover?tab=roadmap", dark: true });
    await roadmap.page.getByText("Ausführungspläne für Oracle").waitFor();
    await shoot(roadmap, "27-dark-roadmap");
    const sheet = await boot({ path: "/query", dark: true });
    await sheet.page.mouse.click(1000, 600);
    await sheet.page.keyboard.press("?");
    await sheet.page.getByLabel("Spickzettel durchsuchen").waitFor();
    await shoot(sheet, "28-dark-cheatsheet");
    const spotlight = await boot({
      path: "/query",
      dark: true,
      seeds: {
        "l8db.discovery.spotlight": persisted({
          seenVersion: "0.17.0",
          lastActive: Date.now() - DAY,
        }),
      },
    });
    await quietGate(spotlight.page);
    await spotlight.page.locator('[data-discovery-spotlight="spotlight"]').waitFor();
    await shoot(spotlight, "29-dark-spotlight");
  },
  240_000,
);
