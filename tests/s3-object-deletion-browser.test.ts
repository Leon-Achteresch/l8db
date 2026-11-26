import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const appUrl = process.env.L8DB_S3_DELETE_BROWSER_URL;
interface DeleteRequest {
  bucket: string;
  objects: { key: string; version_id: string | null }[];
  bypassGovernance: boolean;
}
for (const engine of [chromium, webkit]) {
  test.skipIf(!appUrl)(
    `${engine.name()}: bucket visits are idle and deletion describes the current versioning policy`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        let reads = 0;
        let inflight = 0;
        let peak = 0;
        let status = "Enabled";
        let release: (() => void) | undefined;
        const deleted: DeleteRequest[] = [];
        await seedApp(page, 1);
        await page.exposeFunction("deleteVersionStatus", async () => {
          reads++;
          peak = Math.max(peak, ++inflight);
          try {
            if (status === "hold")
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            if (status === "denied") throw new Error("AccessDenied");
            if (status === "Off") return "<VersioningConfiguration/>";
            return `<VersioningConfiguration><Status>${status}</Status></VersioningConfiguration>`;
          } finally {
            inflight--;
          }
        });
        await page.exposeFunction("deleteFixtureObjects", (request: DeleteRequest) => {
          deleted.push(request);
          return { deleted: request.objects.length, errors: [] };
        });
        await page.addInitScript(() => {
          const key = "l8db.connections";
          const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
          Object.assign(saved.state.connections[0], {
            kind: "s3",
            connectionString: "s3://preview",
          });
          localStorage.setItem(key, JSON.stringify(saved));
          const scope = window as unknown as {
            deleteVersionStatus(): Promise<string>;
            deleteFixtureObjects(request: DeleteRequest): Promise<unknown>;
            __TAURI_INTERNALS__: {
              invoke(command: string, args?: DeleteRequest): Promise<unknown>;
            };
          };
          const bridge = scope.__TAURI_INTERNALS__;
          const invoke = bridge.invoke;
          const object = {
            key: "notes.txt",
            size: 12,
            etag: null,
            storage_class: "STANDARD",
            last_modified: null,
          };
          bridge.invoke = async (command, args) => {
            if (command === "s3_list_buckets") return [];
            if (command === "s3_list_objects")
              return { objects: [object], prefixes: [], truncated: false, next_token: null };
            if (command === "s3_list_object_versions")
              return {
                versions: [
                  { ...object, version_id: "v2", is_latest: false, delete_marker: false },
                  {
                    ...object,
                    key: "removed.txt",
                    version_id: "marker",
                    is_latest: true,
                    delete_marker: true,
                  },
                ],
                prefixes: [],
                truncated: false,
                next_key_marker: null,
                next_version_marker: null,
              };
            if (command === "s3_get_config") return scope.deleteVersionStatus();
            if (command === "s3_delete_objects" && args) return scope.deleteFixtureObjects(args);
            return invoke(command, args);
          };
        });
        const select = page.getByRole("checkbox", { name: "notes.txt auswählen" });
        const remove = page.getByRole("button", { name: /^Löschen \(/ });
        const dialog = page.getByRole("alertdialog");
        const cancel = dialog.getByRole("button", { name: "Abbrechen" });
        for (let i = 0; i < 9; i++) {
          await page.goto(`${appUrl}/buckets/b${i}`);
          await select.waitFor();
        }
        expect(reads).toBe(0);
        await select.check();
        for (const [state, message] of [
          ["Enabled", "Ihre bisherigen Versionen bleiben erhalten"],
          ["Suspended", "Null-Versionen"],
          ["Off", "Versionierung ist aus"],
          ["denied", "Versionsstatus ist unbekannt"],
          ["unexpected", "Versionsstatus ist unbekannt"],
        ]) {
          status = state;
          await remove.click();
          await dialog.getByText(message, { exact: false }).waitFor();
          const governance = dialog.getByRole("switch", { name: "Governance umgehen" });
          expect(await governance.isChecked()).toBe(false);
          if (state === "Enabled") {
            await dialog.locator('label[for$="-governance"] > span').click();
            expect(await governance.isChecked()).toBe(true);
          } else {
            expect(await dialog.innerText()).not.toContain(
              "Ihre bisherigen Versionen bleiben erhalten",
            );
          }
          await cancel.click();
        }
        expect(reads).toBe(5);
        status = "denied";
        await remove.click();
        await dialog.getByText(/Versionsstatus ist unbekannt/).waitFor();
        await dialog.getByRole("button", { name: "Löschen", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        expect(deleted).toHaveLength(1);
        expect(deleted[0]).toMatchObject({
          bucket: "b8",
          objects: [{ key: "notes.txt", version_id: null }],
          bypassGovernance: false,
        });
        expect(reads).toBe(6);
        await select.check();
        status = "hold";
        await remove.click();
        await dialog.getByText(/Versionsstatus wird geladen/).waitFor();
        expect(await dialog.innerText()).not.toContain(
          "Ihre bisherigen Versionen bleiben erhalten",
        );
        await cancel.click();
        status = "Off";
        release?.();
        await page.getByRole("button", { name: "Versionen anzeigen" }).click();
        await select.check();
        await page.getByRole("checkbox", { name: "removed.txt auswählen" }).check();
        await remove.click();
        await dialog
          .getByText(/Frühere Objektversionen können dadurch wieder sichtbar werden/)
          .waitFor();
        expect(await dialog.innerText()).toContain("Ausgewählte Objektversionen");
        expect(await dialog.innerText()).not.toContain("Versionsstatus");
        expect(reads).toBe(7);
        expect(deleted).toHaveLength(1);
        await dialog.getByRole("button", { name: "Endgültig löschen" }).click();
        await dialog.waitFor({ state: "hidden" });
        expect(deleted).toHaveLength(2);
        expect(deleted[1]).toMatchObject({
          bucket: "b8",
          objects: [
            { key: "notes.txt", version_id: "v2" },
            { key: "removed.txt", version_id: "marker" },
          ],
          bypassGovernance: false,
        });
        expect(reads).toBe(7);
        expect(peak).toBe(1);
        expect(inflight).toBe(0);
      } finally {
        await browser.close();
      }
    },
    60000,
  );
}
