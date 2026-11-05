import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const base = process.env.L8DB_JDBC_BROWSER_URL;

test.skipIf(!base)(
  "JDBC profile lifecycle keeps secrets off persisted connections and stays idle",
  async () => {
    const browser = await (process.env.L8DB_JDBC_BROWSER_ENGINE === "webkit"
      ? webkit
      : chromium
    ).launch();
    const samples: number[] = [];
    try {
      for (let run = 0; run < 3; run++) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          const state = window as unknown as {
            __jdbcCalls: { command: string; args?: Record<string, unknown> }[];
            __jdbcProfiles: Record<string, unknown>[];
            __TAURI_INTERNALS__: unknown;
          };
          state.__jdbcCalls = [];
          state.__jdbcProfiles = Array.from({ length: 64 }, (_, index) => ({
            id: `profile-${index}`,
            name: `Datenbank ${index}`,
            driverClass: "org.h2.Driver",
            jars: ["h2jar"],
            url: `jdbc:h2:mem:db${index}`,
            username: "sa",
            readOnly: true,
            hasPassword: false,
          }));
          state.__TAURI_INTERNALS__ = {
            transformCallback: () => 1,
            invoke: async (command: string, args?: Record<string, unknown>) => {
              state.__jdbcCalls.push({ command, args });
              if (command === "jdbc_status")
                return {
                  available: true,
                  detail: "JDK 21 verfügbar",
                  jars: [{ id: "h2jar", name: "h2.jar", bytes: 2651157 }],
                  activeProcesses: 0,
                  maxProcesses: 4,
                  idleSeconds: 60,
                };
              if (command === "jdbc_profiles") return state.__jdbcProfiles;
              if (command === "jdbc_catalog")
                return [
                  {
                    id: "h2",
                    name: "H2",
                    driverClass: "org.h2.Driver",
                    urlTemplate: "jdbc:h2:mem:test",
                    documentation: "https://h2database.github.io",
                  },
                ];
              if (command === "jdbc_save_profile") {
                const input = args?.input as Record<string, unknown>;
                const profile = { ...input, password: undefined, hasPassword: true };
                state.__jdbcProfiles = state.__jdbcProfiles.map((current) =>
                  current.id === input.id ? profile : current,
                );
                return profile;
              }
              if (command === "jdbc_remove_profile") {
                state.__jdbcProfiles = state.__jdbcProfiles.filter(
                  (profile) => profile.id !== args?.id,
                );
                return;
              }
              if (command === "jdbc_close_profile") return;
              return null;
            },
          };
        });
        const started = performance.now();
        await page.goto(`${base}/tests/jdbc-fixture.html`);
        await page.getByText("Datenbank 63", { exact: true }).waitFor();
        samples.push(performance.now() - started);
        expect(await page.locator("article").count()).toBe(64);
        expect(await page.locator("*").count()).toBeLessThan(3000);
        const first = page.locator("article").first();
        await first.getByRole("button", { name: "Bearbeiten", exact: true }).click();
        await page.getByLabel("Passwort", { exact: false }).fill("fixture-private-secret");
        await page.getByLabel("Name", { exact: true }).fill("Geändertes Profil");
        await page.getByRole("button", { name: "Speichern", exact: true }).click();
        await page.getByText("Geändertes Profil", { exact: true }).waitFor();
        await page
          .locator("article")
          .first()
          .getByRole("button", { name: "Verbindung hinzufügen" })
          .click();
        const persisted = await page.evaluate(() => JSON.stringify(localStorage));
        expect(persisted).toContain("jdbc:l8db:profile-0");
        expect(persisted).not.toContain("fixture-private-secret");
        expect(persisted).not.toContain("jdbc:h2:mem:db0");
        await page.getByRole("button", { name: "Geändertes Profil trennen", exact: true }).click();
        await page
          .getByRole("button", { name: "Geändertes Profil entfernen", exact: true })
          .click();
        await page.getByRole("button", { name: "Entfernen", exact: true }).click();
        await page.getByText("Geändertes Profil", { exact: true }).waitFor({ state: "detached" });
        expect(await page.locator("article").count()).toBe(63);
        const calls = () =>
          page.evaluate(
            () => (window as unknown as { __jdbcCalls: { command: string }[] }).__jdbcCalls,
          );
        const before = (await calls()).length;
        await page.waitForTimeout(250);
        expect((await calls()).length).toBe(before);
        expect((await calls()).filter((call) => call.command === "jdbc_save_profile").length).toBe(
          1,
        );
        expect(
          (await calls()).filter((call) => call.command === "jdbc_remove_profile").length,
        ).toBe(1);
        expect((await calls()).filter((call) => call.command === "jdbc_close_profile").length).toBe(
          1,
        );
        await page.setViewportSize({ width: 720, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
        await page.close();
      }
      samples.sort((left, right) => left - right);
      console.log(
        `JDBC browser: 64 profiles, DOM <3000 nodes, no idle requests, median ${samples[1]?.toFixed(1)} ms, p95 ${samples[2]?.toFixed(1)} ms`,
      );
      expect(samples[1]).toBeLessThan(8000);
      expect(samples[2]).toBeLessThan(12000);
    } finally {
      await browser.close();
    }
  },
  120_000,
);
