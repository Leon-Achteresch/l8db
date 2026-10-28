import { expect, test } from "bun:test";
import { chromium } from "playwright";

const url = process.env.L8DB_QUERY_BROWSER_URL;

test.skipIf(!url)(
  "KI-Chat-Änderung steht nur einmal im Editor und lässt sich ablehnen",
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/tests/fixtures/editor-ai-chat.html`);
      await page.waitForFunction(() => typeof window.runChatEdits === "function");
      const original = "-- Entwurf: Signatur prüfen.\nSELECT 1 FROM dual;\n";
      const first = "DECLARE\n  l_result NUMBER;\nBEGIN\n  l_result := 1;\nEND;\n";
      const second = "DECLARE\n  l_result NUMBER;\nBEGIN\n  l_result := 2;\nEND;\n/\n";
      const result = await page.evaluate(([text, edits]) => window.runChatEdits(text, edits), [
        original,
        [first, second],
      ] as const);
      expect(result.values).toEqual([first, second]);
      expect(result.pending.every((count) => count > 0)).toBe(true);
      expect(result.rejected).toBe(original);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  60_000,
);
