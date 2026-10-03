import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import manifest from "../extention/password-manager/l8db-extension.json";
import config from "../src-tauri/tauri.conf.json";
import { bundleFixture } from "./fixtures/browser-bundle";

test.skipIf(!process.env.L8DB_EXTENSION_BROWSER)(
  "Passwortmanager lädt geteilte Zugänge und speichert Verbindungen im persönlichen Tresor",
  async () => {
    const archive = await readFile(
      `extention/password-manager/${manifest.id}-${manifest.version}.l8db-extension`,
      "utf8",
    );
    const output = await bundleFixture("tests/fixtures/password-manager-browser.tsx");
    const csp = Object.entries(config.app.security.csp)
      .map(([key, value]) => `${key} ${value}`)
      .join("; ");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/test.js")
          return new Response(output, { headers: { "Content-Type": "text/javascript" } });
        if (new URL(request.url).pathname === "/start.js")
          return new Response(
            "window.pmArchive = JSON.parse(document.getElementById('archive').textContent)",
            { headers: { "Content-Type": "text/javascript" } },
          );
        return new Response(
          `<div id="root"></div><script type="application/json" id="archive">${archive.replaceAll("<", "\\u003c")}</script><script src="/start.js"></script><script type="module" src="/test.js"></script>`,
          {
            headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp },
          },
        );
      },
    });
    const browser = await (process.env.L8DB_EXTENSION_BROWSER === "webkit"
      ? webkit
      : chromium
    ).launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://localhost:${server.port}`);
      const card = page.getByRole("article", { name: "Passwortmanager-Sync" });
      await card.getByRole("button", { name: "Aktivieren", exact: true }).click();
      for (const box of await card.getByRole("checkbox").all())
        if (!(await box.isChecked())) await box.check();
      await card.getByRole("button", { name: "Erlauben und aktivieren" }).click();
      await card.getByText("Bitwarden", { exact: true }).click();
      await card.getByLabel("E-Mail").fill("admin@firma.de");
      await card.getByLabel("Master-Passwort").fill("master");
      await card.getByRole("button", { name: "Anmelden" }).click();
      await card.getByText("1 Datenbank-Zugang ist in l8db verfügbar (1 neu).").waitFor();
      const received = await page.evaluate(() =>
        (
          window as unknown as {
            pmState: {
              connections: { name: string; connectionString: string; password: string }[];
            };
          }
        ).pmState.connections.map(({ name, connectionString, password }) => ({
          name,
          connectionString,
          password,
        })),
      );
      expect(received).toContainEqual({
        name: "Buchhaltung",
        connectionString: "postgres://buchhaltung@db.firma.local:5432/finanzen",
        password: "geheim",
      });

      await card.getByRole("button", { name: "Bestehende übernehmen" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("In Bitwarden speichern").waitFor();
      const buchhaltung = dialog.getByRole("checkbox", { name: /Buchhaltung/ });
      if (await buchhaltung.isChecked()) await buchhaltung.uncheck();
      await dialog.getByRole("button", { name: /Übernehmen/ }).click();
      await dialog.getByText("Bitwarden: 1 angelegt, 0 aktualisiert.").waitFor();
      await dialog.getByRole("button", { name: "OK" }).click();
      await card.getByText("2 Datenbank-Zugänge sind in l8db verfügbar.").waitFor();
      const shared = await page.evaluate(() =>
        (window as unknown as { pmState: { vault: Record<string, unknown>[] } }).pmState.vault.find(
          (item) => item.name === "l8db: Staging",
        ),
      );
      expect(shared?.organizationId).toBeUndefined();
      expect(shared?.collectionIds).toBeUndefined();
      expect(shared).toMatchObject({
        login: {
          username: "app",
          password: "staging-pw",
          uris: [{ uri: "mysql://app@staging.firma.local:3306/shop" }],
        },
      });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
