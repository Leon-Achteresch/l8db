import { afterAll, beforeAll, expect, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import { type Browser, chromium, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const ZERO = "0".repeat(40);
const DAY = 86_400_000;

type Entry = { hash: string; author: string; mail: string; time: number; summary: string };

function porcelain(path: string, lines: string[], owners: Entry[]): string {
  const seen = new Set<string>();
  return lines
    .map((text, index) => {
      const owner = owners[index];
      const header = `${owner.hash} ${index + 1} ${index + 1} 1`;
      const body = seen.has(owner.hash)
        ? []
        : [
            `author ${owner.author}`,
            `author-mail <${owner.mail}>`,
            `author-time ${Math.floor(owner.time / 1000)}`,
            "author-tz +0100",
            `committer ${owner.author}`,
            `summary ${owner.summary}`,
            `filename ${path}`,
          ];
      seen.add(owner.hash);
      return [header, ...body, `\t${text}`].join("\n");
    })
    .join("\n");
}

const now = Date.now();
const ada: Entry = {
  hash: "a".repeat(40),
  author: "Ada Lovelace",
  mail: "ada@example.invalid",
  time: now - 3 * DAY,
  summary: "feat: calc anlegen",
};
const grace: Entry = {
  hash: "b".repeat(40),
  author: "Grace Hopper",
  mail: "grace@example.invalid",
  time: now - 2 * 3_600_000,
  summary: "fix: Ergebnis korrigieren",
};
const local: Entry = { ...ada, hash: ZERO, author: "Not Committed Yet", summary: "Version of x" };

const routineFile = [
  "CREATE OR REPLACE FUNCTION public.calc()",
  " RETURNS integer",
  " LANGUAGE sql",
  "AS $function$",
  "SELECT 1",
  "$function$",
];
const specFile = ["PACKAGE billing AS", "  PROCEDURE run;", "END billing;"];
const bodyFile = ["PACKAGE BODY billing AS", "  PROCEDURE run IS BEGIN NULL; END;", "END billing;"];
const project = {
  format: 1,
  id: "blame",
  name: "Blame",
  kind: "postgres",
  objects: [
    {
      id: "calc",
      path: "database/objects/calc.sql",
      selection: { schema: "public", objectType: "routine", objectName: "calc", objectOid: null },
    },
    {
      id: "billing",
      path: "database/objects/billing.pks",
      bodyPath: "database/objects/billing.pkb",
      selection: {
        schema: "public",
        objectType: "package",
        objectName: "billing",
        objectOid: null,
      },
    },
  ],
};

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(routine: { file: string[]; owners: Entry[]; editor: string }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const blames: Record<string, string> = {
    "database/objects/calc.sql": porcelain("calc.sql", routine.file, routine.owners),
    "database/objects/billing.pks": porcelain("billing.pks", specFile, [ada, local, ada]),
    "database/objects/billing.pkb": porcelain("billing.pkb", bodyFile, [grace, grace, grace]),
  };
  await context.addInitScript(
    ({ blames, project, sources }) => {
      localStorage.setItem("l8db.versioning.repo", "/repo");
      localStorage.setItem(
        "l8db.connections",
        JSON.stringify({
          state: {
            activeId: "pg",
            connections: [
              {
                id: "pg",
                name: "PG",
                kind: "postgres",
                connectionString: "postgresql://fixture@127.0.0.1:5432/app?sslmode=disable",
                sslMode: "disable",
              },
            ],
          },
          version: 0,
        }),
      );
      const calls: string[] = [];
      Object.assign(window, {
        gitBlameSources: sources,
        gitBlameCalls: calls,
        __TAURI_INTERNALS__: {
          invoke: async (command: string, args?: { request?: Record<string, string> }) => {
            if (command !== "versioning_repository") {
              if (command.startsWith("list_")) return [];
              return null;
            }
            const request = args?.request ?? {};
            calls.push(`${request.action}:${request.path}`);
            if (request.action === "read" && request.path === "database/project.json")
              return JSON.stringify(project);
            if (request.action === "blame") return blames[request.path] ?? null;
            throw new Error(`Unerwartete Aktion ${request.action}`);
          },
          transformCallback: () => 0,
        },
      });
    },
    {
      blames,
      project,
      sources: {
        routine: routine.editor,
        spec: `${specFile.join("\n")}\n`,
        body: bodyFile.join("\n"),
      },
    },
  );
  const page = await context.newPage();
  await page.goto(`${url}/tests/fixtures/git-blame.html`);
  await page.locator(".monaco-editor .view-line").first().waitFor();
  return page;
}

const annotation = (page: Page) => page.locator(".view-lines .git-blame-annotation");

async function labelOf(page: Page, text: string): Promise<string> {
  const handle = await page.waitForFunction((text) => {
    const line = [...document.querySelectorAll(".view-lines .view-line")].find(
      (node) =>
        node.querySelector(".git-blame-annotation") &&
        node.textContent?.replace(/\u00a0/g, " ").includes(text),
    );
    return line
      ? [...line.querySelectorAll(".git-blame-annotation")]
          .map((node) => node.textContent ?? "")
          .join("")
          .replace(/\u00a0/g, " ")
      : null;
  }, text);
  return (await handle.jsonValue()) as string;
}

async function blameAt(page: Page, text: string): Promise<string> {
  await page.locator(".view-lines .view-line", { hasText: text }).last().click();
  return labelOf(page, text);
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { gitBlameCalls: string[] }).gitBlameCalls.slice());

run(
  "shows VS Code style blame for the cursor line, maps DB text and handles edits",
  async () => {
    const editor = [...routineFile.slice(0, 4), "SELECT 2", routineFile[5]]
      .map((line, index) => (index === 0 ? `${line}   ` : line))
      .join("\r\n");
    const page = await fixture({
      file: routineFile,
      owners: [ada, ada, ada, ada, grace, ada],
      editor,
    });
    try {
      expect(await blameAt(page, "LANGUAGE sql")).toBe(
        "feat: calc anlegen, Ada Lovelace (vor 3 Tagen)",
      );
      expect(await page.locator(".view-lines .view-line:has(.git-blame-annotation)").count()).toBe(
        1,
      );

      const box = await annotation(page).first().boundingBox();
      if (!box) throw new Error("Annotation fehlt");
      await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 5 });
      const hover = page.locator(".monaco-hover-content", { hasText: "Ada Lovelace" });
      await hover.waitFor();
      const hoverText = await hover.innerText();
      expect(hoverText).toContain("<ada@example.invalid>");
      expect(hoverText).toContain("aaaaaaaa");
      expect(hoverText).toContain("feat: calc anlegen");
      expect(hoverText).toContain("vor 3 Tagen");

      expect(await blameAt(page, "CREATE OR REPLACE")).toContain("Ada Lovelace");
      expect(await blameAt(page, "SELECT 2")).toBe("Weicht vom Repository ab");
      expect(await blameAt(page, "$function$")).toContain("Ada Lovelace");

      await page.getByRole("button", { name: "Bearbeiten" }).click();
      await blameAt(page, "LANGUAGE sql");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("-- neu", { delay: 30 });
      expect(await labelOf(page, "-- neu")).toBe("Weicht vom Repository ab");
      await page.keyboard.press("ArrowDown");
      expect(await labelOf(page, "AS $function$")).toContain("Ada Lovelace");
      await page.keyboard.press("ArrowDown");
      expect(await labelOf(page, "SELECT 2")).toBe("Weicht vom Repository ab");

      await page.getByRole("button", { name: "spec" }).click();
      expect(await blameAt(page, "PROCEDURE run;")).toBe("Noch nicht committet");
      await page.getByRole("button", { name: "body" }).click();
      expect(await blameAt(page, "PROCEDURE run IS")).toBe(
        "fix: Ergebnis korrigieren, Grace Hopper (vor 2 Stunden)",
      );
      await page.getByRole("button", { name: "spec" }).click();
      expect(await blameAt(page, "END billing;")).toContain("Ada Lovelace");

      await page.waitForTimeout(1500);
      expect((await calls(page)).sort()).toEqual([
        "blame:database/objects/billing.pkb",
        "blame:database/objects/billing.pks",
        "blame:database/objects/calc.sql",
        "read:database/project.json",
      ]);
    } finally {
      await page.context().close();
    }
  },
  60_000,
);

run(
  "keeps cursor-line blame fast and bounded for a 20,000 line definition",
  async () => {
    const lines = 20_000;
    const file = Array.from({ length: lines }, (_, index) => `  v_${index} := ${index};`);
    const owners = file.map((_, index) => (index % 2 ? ada : grace));
    const editor = [...file];
    editor[10_000] = "  v_changed := 0;";
    const page = await fixture({ file, owners, editor: editor.join("\n") });
    try {
      expect(await blameAt(page, "v_0 :=")).toContain("Grace");
      const samples: number[] = [];
      for (let step = 1; step <= 40; step++) {
        const expected = step % 2 ? "Ada" : "Grace";
        const started = performance.now();
        await page.keyboard.press("ArrowDown");
        expect(await labelOf(page, `v_${step} :=`)).toContain(expected);
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)];
      const p95 = samples[Math.floor(samples.length * 0.95)];
      expect(await page.locator(".view-lines .view-line:has(.git-blame-annotation)").count()).toBe(
        1,
      );
      expect((await calls(page)).length).toBe(2);
      console.info(
        `git blame 20k Zeilen: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (${platform()} ${arch()}, ${cpus()[0]?.model}, ${Math.round(totalmem() / 2 ** 30)} GB)`,
      );
      expect(median).toBeLessThan(250);
      expect(p95).toBeLessThan(400);
    } finally {
      await page.context().close();
    }
  },
  90_000,
);
