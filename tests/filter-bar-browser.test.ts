import { expect, test } from "bun:test";
import { type Browser, type BrowserType, chromium, type Page, webkit } from "playwright";

const url = process.env.L8DB_FILTER_BROWSER_URL;
const shots = process.env.L8DB_FILTER_SCREENSHOTS;

async function open(browser: Browser, query: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1180, height: 640 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  await page.addInitScript(() => {
    const state = window as unknown as Record<string, unknown> & {
      __invokes: { cmd: string; args: Record<string, unknown> }[];
      __aiReplies: string[];
      __reject?: (error: Error) => void;
    };
    state.__invokes = [];
    state.__aiReplies = [];
    let next = 1;
    state.__TAURI_INTERNALS__ = {
      transformCallback: (callback: unknown) => {
        const id = next++;
        state[`_${id}`] = callback;
        return id;
      },
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        state.__invokes.push({ cmd, args });
        if (cmd === "ai_complete") {
          const reply = state.__aiReplies.shift();
          if (reply?.startsWith("__delay__"))
            return new Promise((resolve) =>
              setTimeout(
                () => resolve({ text: reply.slice(9), truncated: false, model: "mock" }),
                1_500,
              ),
            );
          if (reply === "__hang__")
            return new Promise((_resolve, reject) => {
              state.__reject = reject;
            });
          return { text: reply ?? "{}", truncated: false, model: "mock" };
        }
        if (cmd === "ai_complete_cancel") {
          state.__reject?.(new Error("Abgebrochen"));
          return null;
        }
        return [];
      },
    };
  });
  await page.goto(`${url}/tests/fixtures/filter-bar.html?${query}`);
  return { page, errors };
}

const reply = (page: Page, text: string) =>
  page.evaluate((value) => {
    (window as unknown as { __aiReplies: string[] }).__aiReplies.push(value);
  }, text);

const aiCalls = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __invokes: { cmd: string; args: Record<string, unknown> }[] }).__invokes
      .filter((call) => call.cmd === "ai_complete" || call.cmd === "ai_complete_cancel")
      .map((call) => ({
        cmd: call.cmd,
        text:
          call.cmd === "ai_complete"
            ? (call.args.request as { messages: { text: string }[] }).messages[0].text
            : "",
      })),
  );

const applied = (page: Page) => page.getByLabel("Applied filter").textContent();
const raw = (page: Page) => page.getByLabel("Raw SQL").textContent();

async function shot(page: Page, name: string, engine: string) {
  if (shots && engine === "chromium") await page.screenshot({ path: `${shots}/${name}.png` });
}

async function rowBackground(page: Page, text: string) {
  return page
    .getByRole("row")
    .filter({ hasText: text })
    .first()
    .evaluate((row) => getComputedStyle(row).backgroundColor);
}

for (const engine of [chromium, webkit] as BrowserType[]) {
  test.skipIf(!url)(
    `${engine.name()}: omnibar filters, colours and asks the AI safely`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const { page, errors } = await open(browser, "style=omnibar");
        const input = page.getByRole("combobox", { name: "Filter eingeben oder KI fragen" });
        await input.click();
        await page.getByText("In eigenen Worten die KI fragen").waitFor();

        await input.fill("sta");
        await page.getByRole("option", { name: /status/ }).waitFor();
        await input.press("Tab");
        expect(await input.inputValue()).toBe("status ");
        await input.pressSequentially("= 'error'");
        await page.getByRole("option", { name: /Filter hinzufügen/ }).waitFor();
        await input.press("Enter");
        expect(await applied(page)).toBe(`"status"::text ILIKE 'error' ESCAPE '!'`);
        expect(await raw(page)).toBe("false");
        expect(await input.inputValue()).toBe("");
        await page.getByRole("button", { name: "Filter entfernen: status = error" }).waitFor();

        await input.fill("tokens > 4000");
        await input.press("Shift+Enter");
        await page.getByRole("button", { name: "Farbregel entfernen: tokens > 4000" }).waitFor();
        expect(await rowBackground(page, "5880")).not.toBe(await rowBackground(page, "1204"));

        await input.fill("ganz normaler Text");
        await page.getByText(/Kein einfacher Filter/).waitFor();
        await page.getByRole("option", { name: /Mit KI filtern/ }).waitFor();
        await input.press("Enter");
        await page
          .getByRole("alert")
          .filter({ hasText: /Kein einfacher Filter/ })
          .waitFor();
        expect(await aiCalls(page)).toEqual([]);

        await input.fill("tokens = 1 or tokens = 2");
        await input.press("Enter");
        await page
          .getByRole("alert")
          .filter({ hasText: /gemischt bitte im SQL-Modus/ })
          .waitFor();
        expect(await applied(page)).toBe(`"status"::text ILIKE 'error' ESCAPE '!'`);

        await reply(
          page,
          'Klar, hier ist der Filter:\n```json\n{"filters":[{"column":"STATUS","operator":"==","value":"\'error\'"},{"column":"created_at","operator":">=","value":"2026-10-10"},{"column":"ghost","value":1}],"rules":[{"color":"gelb","conditions":[{"column":"tokens","operator":"gt","value":4000}]}],}\n```',
        );
        await input.fill("nur Fehler seit letzter Woche, teure gelb");
        await input.press("ControlOrMeta+Enter");
        await page
          .getByText("KI-Vorschlag für „nur Fehler seit letzter Woche, teure gelb“")
          .waitFor();
        await page.getByText("Spalte „ghost“ gibt es nicht – Bedingung übersprungen.").waitFor();
        await page.getByText("created_at ≥ 2026-10-10").waitFor();
        await shot(page, "omnibar-ai-preview", engine.name());
        await input.press("Enter");
        expect(await applied(page)).toContain(`"created_at" >=`);
        expect(await applied(page)).toContain(`"status"::text ILIKE 'error'`);
        expect(await input.inputValue()).toBe("");
        const calls = await aiCalls(page);
        expect(calls).toHaveLength(1);
        expect(calls[0].text).toContain("Request: nur Fehler seit letzter Woche, teure gelb");
        expect(calls[0].text).toContain('"column":"status"');

        await reply(page, "Ich bin nur ein Sprachmodell und kann keine Filter setzen.");
        await input.fill("irgendwas");
        await input.press("ControlOrMeta+Enter");
        await page.getByText(/Die KI hat keinen Filter geliefert/).waitFor();
        await page.getByRole("button", { name: "Erneut versuchen" }).waitFor();
        await input.press("Escape");
        await page.getByText(/Die KI hat keinen Filter geliefert/).waitFor({ state: "hidden" });

        expect(await input.inputValue()).toBe("irgendwas");
        await reply(page, '{"sql":"1=1; DROP TABLE messages"}');
        await input.press("ControlOrMeta+Enter");
        await page.getByText(/ungültigen Ausdruck/).waitFor();
        await input.press("Escape");

        const before = await applied(page);
        await reply(page, "__hang__");
        await input.press("ControlOrMeta+Enter");
        await page.getByText(/KI erstellt den Filter/).waitFor();
        await input.press("Escape");
        await page.getByText(/KI erstellt den Filter/).waitFor({ state: "hidden" });
        expect((await aiCalls(page)).at(-1)?.cmd).toBe("ai_complete_cancel");
        expect(await applied(page)).toBe(before);
        await input.fill("");

        await input.click();
        await shot(page, "omnibar", engine.name());

        await page.getByRole("button", { name: "SQL", exact: true }).click();
        const editor = page.locator("[data-filter-sql] .cm-content");
        await editor.waitFor();
        expect(await editor.textContent()).toContain(`"status"::text ILIKE 'error'`);
        await editor.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type("tokens > 100");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Enter");
        expect(await applied(page)).toBe("tokens > 100");
        expect(await raw(page)).toBe("true");
        await editor.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type("nur kleine IDs");
        await reply(page, '{"sql":"tokens > 100 AND id < 3"}');
        await page.keyboard.press("ControlOrMeta+Enter");
        await page.getByText("KI-Vorschlag für „nur kleine IDs“").waitFor();
        const sqlCall = (await aiCalls(page)).at(-1)?.text ?? "";
        expect(sqlCall).toContain("Current SQL: tokens > 100");
        expect(sqlCall).toContain("Request: nur kleine IDs");
        await page.keyboard.press("Enter");
        expect(await applied(page)).toBe("tokens > 100 AND id < 3");
        await shot(page, "omnibar-sql", engine.name());

        await page.getByRole("button", { name: "Einfach", exact: true }).click();
        await page.getByRole("button", { name: "Filter entfernen: tokens > 100" }).waitFor();
        expect(await raw(page)).toBe("false");

        await page.getByRole("button", { name: "SQL", exact: true }).click();
        await editor.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type("created_at >= now() - interval '1 day'");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Enter");
        await page.getByRole("button", { name: "Einfach", exact: true }).click();
        await page
          .getByRole("alert")
          .filter({ hasText: /Unerwarteter Ausdruck.*bleibt im SQL-Modus/ })
          .waitFor();
        expect(
          await page.getByRole("button", { name: "SQL", exact: true }).getAttribute("aria-pressed"),
        ).toBe("true");

        await editor.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.insertText("tokens > 100\n-- nur kleine IDs\nAND id < 5");
        await page.getByRole("button", { name: "Anwenden", exact: true }).click();
        expect(await applied(page)).toBe("tokens > 100\n-- nur kleine IDs\nAND id < 5");
        await page.getByRole("button", { name: "Mehrzeiligen SQL-Filter bearbeiten" }).waitFor();
        await page.getByRole("button", { name: "Einfach", exact: true }).click();
        await page
          .getByRole("alert")
          .filter({ hasText: /Kommentare sind nicht erlaubt/ })
          .waitFor();

        await page.getByRole("button", { name: "Alle Filter entfernen" }).click();
        expect(await applied(page)).toBe("");
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    120_000,
  );

  test.skipIf(!url)(
    `${engine.name()}: pill bar edits pills, colours rows and previews AI changes`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const { page, errors } = await open(browser, "style=pills");
        await page.getByRole("button", { name: "Filter hinzufügen" }).click();
        await page.getByText("Neuer Filter").waitFor();
        await page.getByRole("combobox", { name: "Spalte" }).click();
        await page.getByRole("option", { name: "status", exact: true }).click();
        await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Bitte einen Wert eingeben." }).waitFor();
        await page.getByRole("textbox", { name: "Wert" }).fill("error");
        await page.getByRole("textbox", { name: "Wert" }).press("Enter");
        expect(await applied(page)).toBe(`"status"::text ILIKE 'error' ESCAPE '!'`);
        await page.getByText("Neuer Filter").waitFor({ state: "hidden" });

        await page.getByRole("button", { name: "error", exact: true }).click();
        const value = page.getByRole("textbox", { name: "Wert" });
        expect(await value.evaluate((element) => element === document.activeElement)).toBe(true);
        await value.fill("ok");
        await value.press("Enter");
        expect(await applied(page)).toBe(`"status"::text ILIKE 'ok' ESCAPE '!'`);
        await value.waitFor({ state: "hidden" });

        await page.getByRole("button", { name: "Farbregel hinzufügen" }).click();
        await page.getByText("Neue Farbregel").waitFor();
        await page.getByRole("button", { name: "Grün" }).click();
        await page.getByRole("combobox", { name: "Spalte" }).click();
        await page.getByRole("option", { name: "tokens", exact: true }).click();
        await page.getByRole("combobox", { name: "Filteroperator" }).click();
        await page.getByRole("option", { name: "ist größer als" }).click();
        await page.getByRole("textbox", { name: "Wert" }).fill("1000");
        await page.getByRole("button", { name: "Regel hinzufügen", exact: true }).click();
        await page.getByText("Neue Farbregel").waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Farbregel entfernen: tokens > 1000" }).waitFor();
        expect(await rowBackground(page, "5880")).not.toBe(await rowBackground(page, "312"));

        await page.getByRole("button", { name: "KI", exact: true }).click();
        const prompt = page.getByRole("textbox", { name: "KI-Anfrage für Filter und Farbregeln" });
        await prompt.waitFor();
        expect(await prompt.evaluate((element) => element === document.activeElement)).toBe(true);
        await page.getByText(/aber keine Tabellenzeilen/).waitFor();
        await reply(
          page,
          '{"filters":[{"column":"status","operator":"eq","value":"ok"},{"column":"id","operator":"in","value":"1, 3"}],"combinator":"OR","note":"Status ok oder ID 1 bzw. 3."}',
        );
        await prompt.fill("ok oder id 1 und 3");
        await prompt.press("Enter");
        await page.getByText("Status ok oder ID 1 bzw. 3.").waitFor();
        await page.getByText("Bedingungen mit „oder“ verknüpft").waitFor();
        await shot(page, "pills-ai-preview", engine.name());
        await page.getByRole("button", { name: "Übernehmen" }).click();
        await prompt.waitFor({ state: "hidden" });
        expect(await applied(page)).toBe(`"status"::text ILIKE 'ok' ESCAPE '!' OR "id" IN (1, 3)`);
        await page
          .getByRole("button", { name: "Verknüpfung „oder“, klicken zum Wechseln" })
          .waitFor();

        await page.getByRole("button", { name: "KI", exact: true }).click();
        await reply(
          page,
          '{"filters":[{"column":"status","value":"ok"},{"column":"id","operator":"in","value":["3","1"]}]}',
        );
        await prompt.fill("dasselbe nochmal");
        await prompt.press("Enter");
        await page.getByText("Keine Änderung nötig.").waitFor();
        await page.getByRole("button", { name: "Schließen" }).click();

        await reply(page, '__delay__{"filters":[]}');
        await prompt.fill("alles weg");
        await prompt.press("Enter");
        await page.getByText(/KI erstellt den Filter/).waitFor();
        await page.keyboard.press("Escape");
        await prompt.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Farbregel entfernen: tokens > 1000" }).click();
        await page.getByRole("button", { name: "KI", exact: true }).click();
        await page.getByRole("button", { name: "Übernehmen" }).click();
        await page.getByText(/während der KI-Anfrage geändert/).waitFor();
        expect(await applied(page)).toContain("ILIKE 'ok'");
        await page.keyboard.press("Escape");

        await page
          .getByRole("button", { name: "Verknüpfung „oder“, klicken zum Wechseln" })
          .click();
        expect(await applied(page)).toContain(" AND ");
        await page
          .getByRole("button", { name: "error", exact: true })
          .waitFor({ state: "detached" });
        await shot(page, "pills", engine.name());

        await page.getByRole("button", { name: "Extern zurücksetzen" }).click();
        expect(await applied(page)).toBe("");
        expect(await page.getByRole("button", { name: /^Filter entfernen:/ }).count()).toBe(0);
        expect(await page.getByRole("button", { name: "Alle Filter entfernen" }).count()).toBe(0);
        await page.getByRole("button", { name: "Filter hinzufügen" }).click();
        await page.getByRole("combobox", { name: "Spalte" }).click();
        await page.getByRole("option", { name: "id", exact: true }).click();
        await page.getByRole("textbox", { name: "Wert" }).fill("4");
        await page.getByRole("textbox", { name: "Wert" }).press("Enter");
        expect(await applied(page)).toBe(`"id" = 4`);
        await page.getByRole("button", { name: "Filter entfernen: id = 4" }).click();
        expect(await applied(page)).toBe("");
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    120_000,
  );

  test.skipIf(!url)(`${engine.name()}: settings switch between the three styles`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const { page, errors } = await open(browser, "style=classic&settings");
      const group = page.getByRole("radiogroup", { name: "Filterleiste" });
      await group.waitFor();
      expect(await group.getByRole("radio").count()).toBe(3);
      await page.getByRole("button", { name: "Filter", exact: true }).waitFor();
      await shot(page, "settings", engine.name());
      await page.locator('[data-filter-bar-style="omnibar"]').click();
      await page.getByRole("combobox", { name: "Filter eingeben oder KI fragen" }).waitFor();
      await page.locator('[data-filter-bar-style="pills"]').click();
      await page.getByRole("button", { name: "Filter hinzufügen" }).waitFor();
      await page.locator('[data-filter-bar-style="classic"]').click();
      await page.getByRole("button", { name: "Filter", exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "KI", exact: true }).count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test.skipIf(!url)(`${engine.name()}: late column metadata keeps simple filters`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const { page, errors } = await open(browser, "style=pills&late");
      await page.waitForTimeout(700);
      await page
        .getByRole("button", { name: "Filter entfernen: created_at = 2026-10-01" })
        .waitFor();
      expect(
        await page.getByRole("button", { name: "SQL", exact: true }).getAttribute("aria-pressed"),
      ).toBe("false");
      expect(await page.locator("[data-filter-sql]").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test.skipIf(!url)(`${engine.name()}: Redis keeps the classic key pattern`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const { page, errors } = await open(browser, "style=omnibar&kind=redis");
      await page.getByRole("button", { name: "Filter", exact: true }).waitFor();
      expect(
        await page.getByRole("combobox", { name: "Filter eingeben oder KI fragen" }).count(),
      ).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}
