import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import manifest from "../package.json";
import { featureStorageKey, NEW_FEATURES } from "../src/lib/new-features";
import config from "../src-tauri/tauri.conf.json";
import { seedAiWorkspace } from "./fixtures/ai-workspace";

const enabled = process.env.L8DB_AI_BROWSER ?? process.env.L8DB_PRODUCTION_BROWSER;
test.skipIf(!enabled)(
  "AI island supports native context, streaming, approval, cancellation and safe API persistence under CSP",
  async () => {
    const root = resolve("dist");
    const policy = Object.entries(config.app.security.csp)
      .map(([name, value]) => `${name} ${value}`)
      .join("; ");
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const path = resolve(root, `.${pathname}`);
        if (!path.startsWith(`${root}/`) && path !== root)
          return new Response(null, { status: 403 });
        const file = Bun.file(path);
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(resolve(root, "index.html")), {
          headers: { "Content-Type": "text/html", "Content-Security-Policy": policy },
        });
      },
    });
    const browser = await (enabled === "webkit" ? webkit : chromium).launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedAiWorkspace(page);
      await page.goto(`http://localhost:${server.port}/`);
      await page.getByRole("button", { name: "AI-Arbeitsbereich", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "AI-Arbeitsbereich", exact: true });
      await page.waitForFunction(() => document.fonts.status === "loaded");
      await page.screenshot({ path: resolve(tmpdir(), "l8db-ai-panel-redesign.png") });
      expect(await page.getByLabel("AI-Anbieter auswählen", { exact: true }).count()).toBe(0);
      expect(await panel.getByText("Native Fähigkeiten & Konfiguration").count()).toBe(0);
      const resize = page.getByRole("separator", { name: "AI-Panelbreite anpassen" });
      await resize.focus();
      const oldWidth = Number(await resize.getAttribute("aria-valuenow"));
      await resize.press("ArrowLeft");
      expect(Number(await resize.getAttribute("aria-valuenow"))).toBe(oldWidth + 16);
      const bounds = await resize.boundingBox();
      if (!bounds) throw new Error("Resize handle is not visible");
      expect(bounds.height).toBeGreaterThan(100);
      expect(bounds.width).toBeGreaterThanOrEqual(8);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 - 60, bounds.y + bounds.height / 2, {
        steps: 6,
      });
      await page.mouse.up();
      expect(Number(await resize.getAttribute("aria-valuenow"))).toBe(oldWidth + 76);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");

      await panel.getByRole("button", { name: "Anbieter und Modell auswählen" }).click();
      await page.getByRole("radio", { name: "Gemini CLI", exact: true }).click();
      await page.getByRole("radio", { name: "Eigene Modell-ID …", exact: true }).click();
      await page.getByLabel("Modell-ID", { exact: true }).fill("private-model");
      expect(await page.getByLabel("Modell-ID", { exact: true }).inputValue()).toBe(
        "private-model",
      );
      await page.getByRole("radio", { name: "Fixture model", exact: true }).click();
      await page.keyboard.press("Escape");
      await panel.getByRole("button", { name: "Reasoning auswählen" }).click();
      await page.getByRole("menuitemradio", { name: "high" }).click();
      await panel.getByLabel("Nachricht an AI").fill("@Anal");
      await panel.getByRole("option", { name: "@Analytics", exact: true }).click();
      await panel.getByRole("button", { name: "Kontext", exact: true }).click();
      expect(await page.getByLabel("@Analytics", { exact: true }).isChecked()).toBe(true);
      const skillsSeenKey = featureStorageKey("ai.context.skills");
      const skillsAreNew = manifest.version === NEW_FEATURES["ai.context.skills"];
      if (skillsAreNew)
        expect(await page.evaluate((key) => localStorage.getItem(key), skillsSeenKey)).toBeNull();
      await page.getByLabel("SQL review", { exact: true }).check();
      if (skillsAreNew)
        await page.waitForFunction((key) => localStorage.getItem(key) === "1", skillsSeenKey);
      expect(await page.getByLabel("SQL review", { exact: true }).isChecked()).toBe(true);
      await page.keyboard.press("Escape");
      await panel.getByLabel("Nachricht an AI").fill("Inspect the selected databases");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      await panel.getByText("Read fixture schema", { exact: true }).waitFor();
      expect(await panel.getByText("Streamed schema", { exact: true }).isVisible()).toBe(true);
      const first = await page.evaluate(
        () =>
          (window as unknown as { aiFixture: { requests: Record<string, unknown>[] } }).aiFixture
            .requests[0],
      );
      expect(first.profile).toMatchObject({
        provider: "gemini-cli",
        model: "fixture-model",
        effort: "high",
      });
      expect((first.connections as { id: string }[]).map((entry) => entry.id)).toEqual([
        "perf",
        "mentioned",
      ]);
      expect(first.skills).toEqual(["/tmp/ai-fixture/.agents/skills/sql/SKILL.md"]);
      expect(first).toMatchObject({ allowWrites: false, allowDdl: false });
      await panel.getByRole("button", { name: "Im Arbeitsbereich öffnen", exact: true }).click();
      await page.waitForURL("**/ai");
      await page
        .getByRole("separator", { name: "AI-Panelbreite anpassen" })
        .waitFor({ state: "hidden" });
      await panel.getByRole("button", { name: "Agent stoppen" }).waitFor();
      await page.screenshot({ path: resolve(tmpdir(), "l8db-ai-workspace-redesign.png") });
      await panel.getByRole("button", { name: "Erlauben", exact: true }).click();
      await panel
        .getByLabel("Describe schema focus", { exact: true })
        .fill("Users and relationships");
      await panel.getByRole("button", { name: "Antwort senden", exact: true }).click();
      await panel.getByText("complete.", { exact: true }).waitFor();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { aiFixture: { responses: Record<string, unknown>[] } }).aiFixture
              .responses[0].answer,
        ),
      ).toEqual({ answers: { goal: { answers: ["Users and relationships"] } } });
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("l8db.ai") ?? "{}").sessions?.[0]?.messages?.at(-1)
            ?.text === "Streamed schema \n\ncomplete.",
      );
      const usagePanel = panel.getByRole("region", { name: "Kontext, Tokens und Kosten" });
      expect(await usagePanel.textContent()).toContain("Kontext 4%");
      expect(await usagePanel.textContent()).not.toContain("Eingabe");
      await usagePanel.getByRole("button", { name: "Nutzungsdetails anzeigen" }).click();
      const usageDetails = page.getByRole("dialog", { name: "Nutzungsdetails" });
      expect(await usageDetails.textContent()).toContain("1.234 / 32.000");
      await usageDetails.getByText("Berechnung & weitere Details", { exact: true }).click();
      expect(await usageDetails.textContent()).toContain("20 Tokens");
      const usageBounds = await usageDetails.boundingBox();
      expect(usageBounds?.height).toBeLessThan(600);
      expect((usageBounds?.y ?? 0) + (usageBounds?.height ?? 0)).toBeLessThan(
        (page.viewportSize()?.height ?? 720) + 1,
      );
      await page.keyboard.press("Escape");
      const persisted = await page.evaluate(() => localStorage.getItem("l8db.ai"));
      expect(persisted).not.toContain("postgresql://");
      expect(persisted).not.toContain("connectionString");
      expect(persisted).toContain("totalTokens");
      await panel.getByLabel("Nachricht an AI").fill("Continue");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      await panel.getByRole("button", { name: "Agent stoppen", exact: true }).click();
      await page.waitForFunction(
        () =>
          (window as unknown as { aiFixture: { cancels: string[] } }).aiFixture.cancels.length ===
          1,
      );
      await panel.getByRole("button", { name: "Anbieter und Modell auswählen" }).click();
      await page.getByRole("radio", { name: "OpenAI · API", exact: true }).click();
      await page.keyboard.press("Escape");
      await panel.getByRole("button", { name: "AI-Einstellungen", exact: true }).click();
      await panel
        .getByLabel("API-Schlüssel", { exact: true })
        .fill("fixture-api-key-never-persist");
      await panel.getByRole("button", { name: "Schlüssel speichern", exact: true }).click();
      await page.waitForFunction(() =>
        (window as unknown as { aiFixture: { keys: string[] } }).aiFixture.keys.includes("openai"),
      );
      expect(await page.evaluate(() => localStorage.getItem("l8db.ai"))).not.toContain(
        "fixture-api-key-never-persist",
      );
      await panel.getByRole("button", { name: "Anbieter und Modell auswählen" }).click();
      await page.getByRole("radio", { name: "OpenAI-compatible · API", exact: true }).click();
      await page.keyboard.press("Escape");
      await panel.getByRole("button", { name: "AI-Einstellungen", exact: true }).click();
      await panel.getByLabel("API-Endpoint", { exact: true }).fill("http://localhost:11434/v1");
      await panel.getByRole("button", { name: "AI-Einstellungen", exact: true }).click();
      await panel.getByLabel("Nachricht an AI").fill("Test local model without API key");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      await panel.getByText("Local compatible response", { exact: true }).waitFor();
      expect(await panel.getByText("complete.", { exact: true }).count()).toBe(0);
      expect(
        await panel.getByText("Inspect the selected databases", { exact: true }).isVisible(),
      ).toBe(true);
      await page.goto(`http://localhost:${server.port}/ai`);
      await page
        .getByRole("complementary", { name: "AI-Arbeitsbereich", exact: true })
        .getByLabel("Nachricht an AI")
        .waitFor();
      expect(await page.locator("#ai-page-surface").getByRole("complementary").isVisible()).toBe(
        true,
      );
      await panel.getByLabel("Nachricht an AI").fill("empty-schema");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      const approval = panel.getByRole("group", { name: "Agent benötigt eine Entscheidung" });
      await approval.getByText("MCP-Zugriff bestätigen", { exact: true }).last().waitFor();
      expect(await approval.getByRole("textbox").count()).toBe(0);
      expect(await approval.getByText("Demo", { exact: true }).isVisible()).toBe(true);
      await approval.getByRole("button", { name: "Erlauben", exact: true }).click();
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).waitFor();
      await panel.getByLabel("Nachricht an AI").fill("schema-form");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      await approval.getByRole("button", { name: "Schema", exact: true }).click();
      await approval.getByLabel("Begründung", { exact: false }).fill("Explore structure");
      await approval.getByRole("button", { name: "Antwort senden", exact: true }).click();
      await page.waitForFunction(
        () =>
          (
            window as unknown as {
              aiFixture: { responses: { answer: { content?: { scope?: string } } }[] };
            }
          ).aiFixture.responses.at(-1)?.answer.content?.scope === "Schema",
      );
      await panel.getByLabel("Nachricht an AI").fill("choice-fixture");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      await approval.getByRole("radio", { name: "Schema · Inspect structure" }).click();
      await approval.getByRole("button", { name: "Antwort senden", exact: true }).click();
      await page.waitForFunction(
        () =>
          (
            window as unknown as {
              aiFixture: {
                responses: { answer: { answers?: { scope?: { answers: string[] } } } }[];
              };
            }
          ).aiFixture.responses.at(-1)?.answer.answers?.scope?.answers[0] === "Schema",
      );
      await panel.getByLabel("Nachricht an AI").fill("rich-fixture");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      await approval.getByText("Write fixture row", { exact: true }).waitFor();
      await panel.getByAltText("Bild aus Agent-Ergebnis").waitFor();
      expect(await panel.getByText("SQL proposal", { exact: true }).isVisible()).toBe(true);
      const answerTable = panel.getByRole("table");
      expect(
        await answerTable.getByRole("columnheader", { name: "Column", exact: true }).isVisible(),
      ).toBe(true);
      expect(await answerTable.getByRole("cell", { name: "id", exact: true }).isVisible()).toBe(
        true,
      );
      expect(
        await answerTable.getByRole("cell", { name: "name|alias", exact: true }).isVisible(),
      ).toBe(true);
      expect(
        await answerTable
          .getByRole("cell", { name: "text | value", exact: true })
          .locator("code")
          .count(),
      ).toBe(1);
      expect(
        await answerTable
          .getByRole("cell", { name: "a`|b", exact: true })
          .locator("code")
          .textContent(),
      ).toBe("a`|b");
      expect(
        await answerTable.getByRole("cell", { name: "`unfinished", exact: true }).isVisible(),
      ).toBe(true);
      expect(
        await answerTable.getByRole("cell", { name: "retained", exact: true }).isVisible(),
      ).toBe(true);
      expect(await answerTable.getByRole("row").count()).toBe(5);
      expect(await answerTable.textContent()).not.toContain("---");
      expect(await panel.getByText("Plan des Agents", { exact: true }).count()).toBeGreaterThan(0);
      expect(await panel.getByText("query.sql", { exact: true }).count()).toBeGreaterThan(0);
      await panel.getByText("Tool verwendet", { exact: false }).last().click();
      expect(await panel.getByText("execute_query", { exact: true }).count()).toBeGreaterThan(0);
      const toolResultLabel = await panel
        .getByRole("button")
        .filter({ hasText: "execute_query" })
        .last()
        .innerText();
      expect(toolResultLabel.match(/execute_query/g)).toHaveLength(1);
      await approval.getByRole("button", { name: "Ablehnen", exact: true }).click();
      await approval.getByLabel("Describe schema focus", { exact: true }).fill("Keep read only");
      await approval.getByRole("button", { name: "Antwort senden", exact: true }).click();
      await page.waitForFunction(
        () =>
          (
            window as unknown as { aiFixture: { approvals: { allow: boolean }[] } }
          ).aiFixture.approvals.at(-1)?.allow === false,
      );
      await page.waitForFunction(() =>
        JSON.parse(localStorage.getItem("l8db.ai") ?? "{}").sessions.some(
          (session: { messages: { rich?: { type: string }[] }[] }) =>
            session.messages.some((message) =>
              message.rich?.some((block) => block.type === "image"),
            ),
        ),
      );
      await page.waitForFunction(() =>
        localStorage.getItem("l8db.ai")?.includes('"outcome":"denied"'),
      );
      await page.reload();
      await panel.getByRole("treeitem", { name: "empty-schema", exact: false }).click();
      await panel.getByAltText("Bild aus Agent-Ergebnis").waitFor();
      expect(await panel.getByText("SQL proposal", { exact: true }).isVisible()).toBe(true);
      expect(
        await panel.getByText("Write fixture row · Abgelehnt", { exact: true }).isVisible(),
      ).toBe(true);
      const savedHistory = await page.evaluate(() => localStorage.getItem("l8db.ai"));
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Object.assign(window, { aiStorageFull: true });
        Storage.prototype.setItem = function (key, value) {
          if (key === "l8db.ai" && (window as unknown as { aiStorageFull: boolean }).aiStorageFull)
            throw new DOMException("Quota exceeded", "QuotaExceededError");
          original.call(this, key, value);
        };
      });
      await panel.getByRole("button", { name: "Neues Gespräch", exact: true }).click();
      await panel.getByLabel("Nachricht an AI").fill("quota-fixture");
      await panel.getByRole("button", { name: "Nachricht senden", exact: true }).click();
      const storageError = panel
        .getByRole("alert")
        .filter({ hasText: "AI-Daten konnten nicht lokal gespeichert werden" });
      await storageError.waitFor();
      expect(await page.evaluate(() => localStorage.getItem("l8db.ai"))).toBe(savedHistory);
      await panel.getByRole("button", { name: "Agent stoppen", exact: true }).click();
      await page.evaluate(() => Object.assign(window, { aiStorageFull: false }));
      await panel.getByRole("button", { name: "Actions for quota-fixture", exact: true }).click();
      await page.getByRole("button", { name: "quota-fixture löschen", exact: true }).click();
      await page.waitForFunction(() => localStorage.getItem("l8db.ai")?.includes('"deleted":true'));
      await storageError.waitFor({ state: "hidden" });
      const recoveredHistory = await page.evaluate(() => localStorage.getItem("l8db.ai"));
      expect(recoveredHistory).toContain('"deleted":true');
      expect(recoveredHistory).toContain("SQL proposal");
      expect(recoveredHistory).not.toContain("persistenceError");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  45000,
);
