import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { installVersioningLab } from "./fixtures/versioning-lab";

const enabled = process.env.L8DB_VERSIONING_LAB;

for (const engine of ["chromium", "webkit"] as const) {
  test.skipIf(!enabled)(
    `${engine}: real Git, PostgreSQL single database and customer fleet deployments`,
    async () => {
      if (!enabled) throw new Error("L8DB_VERSIONING_LAB is required");
      const settings = JSON.parse(await readFile(enabled, "utf8"));
      const repo = `${settings.root}/postgres-${engine}-${Date.now()}`;
      await mkdir(repo);
      execFileSync("git", ["init", repo]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Versioning Lab"]);
      execFileSync("git", ["-C", repo, "config", "user.email", "lab@example.invalid"]);
      const browser = await (engine === "chromium" ? chromium : webkit).launch();
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      page.setDefaultTimeout(15000);
      try {
        await installVersioningLab(page, repo);
        await page.goto("http://localhost:1420/versioning");
        await page
          .getByRole("textbox", { name: "Projektname", exact: true })
          .fill("Invoice Product");
        await page
          .getByRole("button", { name: "Versionierungsprojekt anlegen", exact: true })
          .click();
        await page.getByRole("tab", { name: "Datenbanken", exact: true }).waitFor();
        const result = await page.evaluate(
          async ({ repo }) => {
            const { runPostgresScenario } = await import(
              "/tests/fixtures/versioning-postgres-scenario.ts"
            );
            return runPostgresScenario(repo);
          },
          { repo },
        );
        expect(result).toEqual({
          stalePlanBlocked: true,
          concurrentBlocked: true,
          lengths: [2, 1],
          versions: ["v3", "v3", "v1"],
          drift: true,
          driftBlocked: true,
          failed: true,
          rollback: true,
          retryBlocked: true,
          readonlyBlocked: true,
          failureRecorded: true,
        });
        await page.getByRole("button", { name: "Versionierung aktualisieren" }).click();
        await page.getByRole("tab", { name: "Datenbanken", exact: true }).click();
        await page.getByText("Kunde A", { exact: true }).waitFor();
        const panel = page.locator("#versioning-panel");
        expect(await panel.getAttribute("aria-hidden")).toBe("false");
        expect(await page.locator("select:visible").count()).toBe(0);
        await page.getByTestId("versioning-badge").getByText("3", { exact: true }).waitFor();
        await page.getByRole("combobox", { name: "Zielrelease", exact: true }).click();
        await page.getByRole("option", { name: "v3", exact: true }).click();
        await page.getByRole("checkbox", { name: "Ziel auswählen: Kunde EDGE" }).check();
        await page.getByRole("button", { name: "Update für 1 Ziele planen", exact: true }).click();
        await page.getByText("Rollout prüfen", { exact: true }).waitFor();
        await panel.getByRole("button", { name: "Versionierung schließen", exact: true }).click();
        expect(await panel.getAttribute("aria-hidden")).toBe("true");
        await page.locator("header button[aria-controls='versioning-panel']").click();
        await page.getByText("Rollout prüfen", { exact: true }).waitFor();
        expect(
          await page.getByRole("checkbox", { name: "Ziel auswählen: Kunde EDGE" }).isChecked(),
        ).toBe(true);
        await page.getByRole("button", { name: "Transaktionen", exact: true }).click();
        await page.locator("[data-tour='tx-panel']").waitFor();
        expect(await panel.getAttribute("aria-hidden")).toBe("true");
        await page.locator("header button[aria-controls='versioning-panel']").click();
        await page.locator("[data-tour='tx-panel']").waitFor({ state: "detached" });
        await page.screenshot({ path: `/tmp/l8db-versioning-${engine}-fleet.png` });
        await page.getByRole("tab", { name: "Releases", exact: true }).click();
        await page.getByRole("button", { name: "Release vorbereiten", exact: true }).click();
        await page.getByRole("textbox", { name: "Release-ID", exact: true }).fill("draft-check");
        await page.getByTestId("versioning-badge").getByText("4", { exact: true }).waitFor();
        await panel.getByRole("button", { name: "Versionierung schließen", exact: true }).click();
        await page.locator("header button[aria-controls='versioning-panel']").click();
        expect(
          await page.getByRole("textbox", { name: "Release-ID", exact: true }).inputValue(),
        ).toBe("draft-check");
        await page.getByRole("tab", { name: /^Änderungen/ }).click();
        await page.getByRole("alert").filter({ hasText: "Ungespeicherten Entwurf" }).waitFor();
        expect(
          await page
            .getByRole("tab", { name: "Releases", exact: true })
            .getAttribute("aria-selected"),
        ).toBe("true");
        await page.getByRole("button", { name: "Release-Entwurf verwerfen", exact: true }).click();
        await page.getByRole("tab", { name: /^Änderungen/ }).click();
        await page.getByRole("button", { name: "Alle Dateien", exact: true }).click();
        await page.getByRole("button", { name: "invoices public", exact: true }).click();
        await panel.locator(".monaco-diff-editor").waitFor();
        await page.evaluate(async () => {
          const { monaco } = await import("/src/lib/monaco/index.ts");
          const editor = monaco.editor.getDiffEditors().at(-1)?.getModifiedEditor();
          if (!editor) throw new Error("Diff editor missing");
          editor.setValue(`${editor.getValue()}\nSELECT 123 AS unsaved_preview;`);
        });
        await page.getByTestId("versioning-badge").getByText("4", { exact: true }).waitFor();
        await panel.getByRole("button", { name: "Versionierung schließen", exact: true }).click();
        await page.locator("header button[aria-controls='versioning-panel']").click();
        expect(
          await page.evaluate(async () => {
            const { monaco } = await import("/src/lib/monaco/index.ts");
            return monaco.editor
              .getDiffEditors()
              .at(-1)
              ?.getModifiedEditor()
              .getValue()
              .endsWith("SELECT 123 AS unsaved_preview;");
          }),
        ).toBe(true);
        await panel.getByRole("button", { name: "Entwurf verwerfen", exact: true }).click();
        await page.getByRole("button", { name: "feature/approval", exact: true }).click();
        const branches = page.getByRole("dialog", { name: "Branches", exact: true });
        await branches
          .getByRole("combobox", { name: "Git-Branch", exact: true })
          .press("ArrowDown");
        await page.getByRole("option", { name: "main", exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await branches.waitFor({ state: "hidden" });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
        await page.locator("html.dark").waitFor();
        await page.setViewportSize({ width: 1000, height: 800 });
        await page.screenshot({ path: `/tmp/l8db-versioning-${engine}-compact.png` });
        const bounds = await panel.boundingBox();
        expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1001).toBe(true);
      } catch (error) {
        await page.screenshot({ path: `/tmp/l8db-versioning-${engine}-failure.png` });
        console.error(await page.locator("body").innerText());
        throw error;
      } finally {
        await browser.close();
      }
    },
    120000,
  );
}
