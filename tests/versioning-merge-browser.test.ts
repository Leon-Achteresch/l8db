import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_VERSIONING_BROWSER)(
  "branch merge conflicts can be resolved, saved and committed in the versioning UI",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      await seedApp(page, 0);
      await page.addInitScript(() => {
        const current = "CREATE VIEW public.orders AS\nSELECT 3 AS value;\n";
        const base = "CREATE VIEW public.orders AS\nSELECT 1 AS value;\n";
        const incoming = "CREATE VIEW public.orders AS\nSELECT 2 AS value;\n";
        const file = "database/objects/orders.sql";
        const project = JSON.stringify({
          format: 1,
          id: "merge-ui",
          name: "Merge UI",
          kind: "postgres",
          objects: [
            {
              id: "orders",
              path: file,
              selection: {
                schema: "public",
                objectType: "view",
                objectName: "orders",
                objectOid: null,
              },
            },
          ],
        });
        let working = current;
        let committed = current;
        const actions: string[] = [];
        localStorage.setItem("l8db.versioning.repo", "/tmp/merge-ui");
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          versioningMergeActions: string[];
        };
        host.versioningMergeActions = actions;
        const original = host.__TAURI_INTERNALS__.invoke;
        host.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
          if (command !== "versioning_repository") return original(command, args);
          const request = args.request as Record<string, unknown>;
          actions.push(String(request.action));
          switch (request.action) {
            case "status":
              return {
                repo: "/tmp/merge-ui",
                head: "a".repeat(40),
                branch: "customer",
                branches: ["customer", "product"],
                files: ["database/project.json", file],
                changes: working === committed ? "" : ` M ${file}\0`,
                history: "",
              };
            case "read":
              if (request.path === "database/project.json") return project;
              if (request.revision === "b".repeat(40)) return base;
              if (request.revision === "c".repeat(40)) return incoming;
              return working;
            case "diff":
              return { original: committed, modified: working };
            case "local-read":
              return null;
            case "merge-base":
              if (request.name !== "product") throw new Error("Wrong branch");
              return { head: "a".repeat(40), base: "b".repeat(40), incoming: "c".repeat(40) };
            case "merge":
              return {
                content:
                  "CREATE VIEW public.orders AS\n<<<<<<< Aktueller Branch\nSELECT 3 AS value;\n||||||| Gemeinsame Basis\nSELECT 1 AS value;\n=======\nSELECT 2 AS value;\n>>>>>>> Quell-Branch\n",
                conflicts: true,
              };
            case "write":
              if (request.expected !== working) throw new Error("Concurrent change");
              working = String(request.content);
              return null;
            case "commit":
              if (working.includes("<<<<<<<")) throw new Error("Unresolved conflict");
              committed = working;
              return "d".repeat(40);
            default:
              throw new Error(`Unexpected versioning action: ${request.action}`);
          }
        };
      });
      await page.goto(
        `${process.env.L8DB_VERSIONING_BROWSER_URL ?? "http://127.0.0.1:1422"}/versioning`,
      );
      await page.getByRole("button", { name: "Alle Dateien" }).click();
      await page.getByText("orders", { exact: true }).click();
      await page.getByRole("button", { name: "Aus Branch zusammenführen" }).click();
      await page.getByRole("button", { name: "Datei zusammenführen" }).click();
      await page.getByText("Konflikt 1", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "Entwurf speichern" }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: "Quelle übernehmen" }).click();
      const save = page.getByRole("button", { name: "Entwurf speichern" });
      expect(await save.isEnabled()).toBe(true);
      await save.click();
      await page.getByRole("checkbox", { name: `Commit: database/objects/orders.sql` }).check();
      await page.getByRole("button", { name: "Änderungen committen (1)" }).click();
      await page.getByRole("textbox", { name: "Commit-Nachricht" }).fill("Resolve product change");
      await page.getByRole("button", { name: "Commit erstellen" }).click();
      await page
        .locator("#versioning-panel")
        .getByText("Ausgewählte Dateien committet", { exact: true })
        .waitFor();
      const actions = await page.evaluate(
        () => (window as unknown as { versioningMergeActions: string[] }).versioningMergeActions,
      );
      expect(actions).toContain("merge-base");
      expect(actions.indexOf("write")).toBeGreaterThan(actions.indexOf("merge"));
      expect(actions.indexOf("commit")).toBeGreaterThan(actions.indexOf("write"));
    } finally {
      await browser.close();
    }
  },
  45000,
);
