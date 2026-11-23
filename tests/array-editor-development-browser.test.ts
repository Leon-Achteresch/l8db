import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30000);
afterAll(async () => {
  await browser?.close();
});

async function open() {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const f = {
      failRead: false,
      calls: [] as { command: string; args: Record<string, unknown> }[],
      data: {
        columns: ["items", "nums", "empty_items", "null_items"],
        rows: [
          {
            __ctid__: "(0,1)@1@1",
            items: [
              ["a", "b"],
              ["c", "d"],
            ] as unknown,
            nums: "[9007199254740993.1234500,0.1234567890123456789000]",
            empty_items: [] as unknown,
            null_items: null as unknown,
          },
        ],
      },
      details: { items_bounds: "[-2:-1][5:6]" },
    };
    Object.assign(window, {
      __a01: f,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          f.calls.push({ command, args });
          const snapshot = () => structuredClone({ data: f.data, details: f.details });
          if (command === "array_editor_development_context")
            return {
              ephemeral: true,
              token: "l8db_a01_012345abcdef",
              columns: f.data.columns.map((name) => ({
                name,
                data_type: name === "nums" ? "numeric[]" : "text[]",
              })),
              snapshot: snapshot(),
            };
          if (command === "array_editor_development_read") {
            if (f.failRead) {
              f.failRead = false;
              throw Error("synthetic readback unavailable");
            }
            return snapshot();
          }
          if (command === "update_row") {
            const [name, value] = Object.entries(args.updates as Record<string, string | null>)[0];
            if (value === '[["ragged"],[]]') throw Error("synthetic transport: ragged rejected");
            Object.assign(f.data.rows[0], {
              [name]: name === "nums" ? value : value === null ? null : JSON.parse(value),
            });
            return;
          }
          throw Error(`Unexpected command: ${command}`);
        },
      },
    });
  });
  await page.goto(`${url}/?array-editor-development=1`);
  await page.getByRole("button", { name: "items", exact: true }).waitFor();
  return page;
}
const edit = async (page: Page, column: string) => {
  await page.getByRole("button", { name: column, exact: true }).click();
  await page
    .getByRole("dialog")
    .evaluate((dialog) =>
      Promise.all(dialog.getAnimations().map((animation) => animation.finished)),
    );
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  return page.getByRole("textbox");
};
const calls = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __a01: { calls: { command: string; args: Record<string, unknown> }[] };
        }
      ).__a01.calls,
  );

run(
  "actual isolated bootstrap + existing cell dialog keyboard/cancel/NULL/precision/error contracts (mock transport)",
  async () => {
    const page = await open();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const text = '[["雪 O\'Reilly",null],["say\\"hi","a\\\\b"]]';
      const input = await edit(page, "items");
      await input.focus();
      expect(await input.evaluate((element) => document.activeElement === element)).toBe(true);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.insertText(text);
      await page.getByRole("button", { name: "NULL", exact: true }).click();
      await page.getByRole("button", { name: "NULL", exact: true }).click();
      expect(await input.inputValue()).toBe(text);
      await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      expect((await calls(page)).length).toBe(1);
      await page.keyboard.press("Escape");
      await (await edit(page, "items")).fill(text);
      await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect((await calls(page))[1].args.updates).toEqual({ items: text });
      const exact = "[9007199254740995.1234500,0.1234567890123456789001,null]";
      expect(await (await edit(page, "nums")).inputValue()).toContain("9007199254740993.1234500");
      await page.getByRole("textbox").fill(exact);
      await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect((await calls(page))[3].args.updates).toEqual({ nums: exact });
      await edit(page, "empty_items");
      await page.getByRole("button", { name: "NULL", exact: true }).click();
      expect(await page.getByRole("textbox").isDisabled()).toBe(true);
      await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect((await calls(page))[5].args.updates).toEqual({ empty_items: null });
      await edit(page, "null_items");
      await page.getByRole("button", { name: "NULL", exact: true }).click();
      await page.getByRole("textbox").fill("[]");
      await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect((await calls(page))[7].args.updates).toEqual({ null_items: "[]" });
      await (await edit(page, "items")).fill('[["ragged"],[]]');
      await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
      await page
        .getByText("synthetic transport: ragged rejected", { exact: false })
        .first()
        .waitFor();
      expect(await page.getByRole("textbox").inputValue()).toBe('[["ragged"],[]]');
      expect((await calls(page)).at(-1)?.command).toBe("update_row");
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  30000,
);

run(
  "512-element existing editor stays bounded, serial and idle without polling",
  async () => {
    const page = await open();
    try {
      const times: number[] = [];
      for (let index = 0; index < 11; index++) {
        const start = performance.now();
        const input = await edit(page, "items");
        await input.fill(
          JSON.stringify(Array.from({ length: 512 }, (_, value) => `${index}:雪:${value}`)),
        );
        await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        if (index >= 2) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const count = (await calls(page)).length;
      expect(count).toBe(23);
      const nodes = await page.locator("*").count();
      expect(nodes).toBeLessThan(1500);
      await page.waitForTimeout(200);
      expect((await calls(page)).length).toBe(count);
      console.log(
        JSON.stringify({
          scenario: "a01-existing-editor-mock-transport",
          elements: 512,
          medianMs: times[4],
          p95Ms: times[8],
          nodes,
          ipcCalls: count,
          idleCalls: 0,
          actualDBRequests: 0,
        }),
      );
      expect(times[4]).toBeLessThan(1000);
      expect(times[8]).toBeLessThan(2000);
    } finally {
      await page.close();
    }
  },
  30000,
);

run(
  "committed write with failed readback cannot be retried as an unsaved draft",
  async () => {
    const page = await open();
    try {
      await (await edit(page, "items")).fill('["committed"]');
      await page.evaluate(() => {
        (window as unknown as { __a01: { failRead: boolean } }).__a01.failRead = true;
      });
      await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Neu lesen", exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "items", exact: true }).isDisabled()).toBe(
        true,
      );
      expect(await page.getByRole("alert").textContent()).toContain("Gespeichert; Readback fehlt");
      await page.getByRole("button", { name: "Neu lesen", exact: true }).click();
      await page.waitForFunction(
        () =>
          !Array.from(document.querySelectorAll("button")).find(
            (element) => element.textContent === "items",
          )?.disabled,
      );
      expect((await calls(page)).map((call) => call.command)).toEqual([
        "array_editor_development_context",
        "update_row",
        "array_editor_development_read",
        "array_editor_development_read",
      ]);
      expect(await (await edit(page, "items")).inputValue()).toContain("committed");
    } finally {
      await page.close();
    }
  },
  30000,
);
