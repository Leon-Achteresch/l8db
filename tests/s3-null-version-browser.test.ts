import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { parseTags, tagsXml } from "../src/lib/storage/s3";
import { seedApp } from "./fixtures/perf-app";

const appUrl = process.env.L8DB_S3_PREVIEW_BROWSER_URL;
const objectKey = "notes.txt";
const current = "Aktuelle Fassung\n".repeat(500_000);
const archive = "Fassung vor Versionierung";
type Args = {
  key?: string;
  versionId?: string | null;
  maxBytes?: number;
  resource?: string;
  method?: string;
  body?: string;
  url?: string;
};

for (const engine of [chromium, webkit]) {
  test.skipIf(!appUrl)(
    `${engine.name()}: the literal null version stays distinct from the current object`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        const calls: { command: string; args: Args }[] = [];
        const tagSaved = Promise.withResolvers<void>();
        const opened = Promise.withResolvers<void>();
        const tags = new Map([
          ["v2", "aktuell"],
          ["null", "archiv"],
        ]);
        const latest = {
          key: objectKey,
          size: current.length,
          storage_class: "STANDARD",
          etag: "new",
          last_modified: null,
        };
        await seedApp(page, 1);
        await page.exposeFunction("versionedObject", (command: string, args: Args) => {
          calls.push({ command, args });
          const id = args.versionId ?? "v2";
          const text = id === "null" ? archive : current;
          switch (command) {
            case "s3_list_buckets":
              return [{ name: "sample", creation_date: null }];
            case "s3_list_objects":
              return { objects: [latest], prefixes: [], truncated: false, next_token: null };
            case "s3_list_object_versions":
              return {
                versions: [
                  { ...latest, version_id: "v2", is_latest: true, delete_marker: false },
                  {
                    ...latest,
                    size: archive.length,
                    etag: "old",
                    version_id: "null",
                    is_latest: false,
                    delete_marker: false,
                  },
                ],
                prefixes: [],
                truncated: false,
                next_key_marker: null,
                next_version_marker: null,
              };
            case "s3_preview_object": {
              const prefix = text.slice(0, args.maxBytes);
              return {
                size: text.length,
                content_type: "text/plain",
                data: Buffer.from(prefix).toString("base64"),
                truncated: prefix.length !== text.length,
              };
            }
            case "s3_head_object":
              return {
                ...latest,
                size: text.length,
                version_id: id,
                metadata: {},
                tag_count: 1,
                headers: {},
              };
            case "s3_get_config":
              if (args.resource === "tagging")
                return tagsXml([{ key: "status", value: tags.get(id) ?? "" }]);
              if (args.resource === "object-lock")
                return "<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>";
              return null;
            case "s3_put_config":
              if (args.resource === "tagging") tags.set(id, parseTags(args.body ?? "")[0].value);
              tagSaved.resolve();
              return;
            case "s3_presign": {
              const link = new URL("https://example.invalid/sample/notes.txt");
              if (args.versionId != null) link.searchParams.set("versionId", args.versionId);
              return link.href;
            }
            case "plugin:opener|open_url":
              opened.resolve();
              return;
            default:
              throw new Error(`Unerwarteter Testaufruf ${command}`);
          }
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
            versionedObject(command: string, args: Args): Promise<unknown>;
            __TAURI_INTERNALS__: { invoke(command: string, args?: Args): Promise<unknown> };
          };
          const bridge = scope.__TAURI_INTERNALS__;
          const invoke = bridge.invoke;
          bridge.invoke = (cmd, args) =>
            cmd.startsWith("s3_") || cmd === "plugin:opener|open_url"
              ? scope.versionedObject(cmd, args ?? {})
              : invoke(cmd, args);
        });
        await page.goto(`${appUrl}/buckets/sample`);
        const row = page.locator('tr[data-key="notes.txt"]');
        const details = page.getByRole("complementary", { name: "Objektdetails" });
        const last = (command: string) => calls.filter((c) => c.command === command).at(-1)?.args;
        await row.getByText(objectKey, { exact: true }).click();
        await details.getByText(/erste .* geladen/).waitFor();
        expect(last("s3_preview_object")?.versionId).toBeNull();
        await page.getByRole("button", { name: "Versionen anzeigen" }).click();
        const oldRow = row.filter({ has: page.getByTitle("null", { exact: true }) });
        await oldRow.getByText(objectKey, { exact: true }).click();
        await details.getByText(archive, { exact: true }).waitFor();
        expect(last("s3_preview_object")?.versionId).toBe("null");
        expect(await details.locator("pre").innerText()).toBe(archive);
        expect(calls.filter((c) => c.command === "s3_preview_object")).toHaveLength(2);

        const newRow = row.filter({ has: page.getByTitle("v2", { exact: true }) });
        const before = calls.filter((c) => c.command === "s3_preview_object").length;
        const samples: number[] = [];
        for (let i = 0; i < 9; i++) {
          const start = performance.now();
          await newRow.getByText(objectKey, { exact: true }).click();
          await details.getByText(/erste .* geladen/).waitFor();
          await oldRow.getByText(objectKey, { exact: true }).click();
          await details.getByText(archive, { exact: true }).waitFor();
          samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        const reads = calls.filter((c) => c.command === "s3_preview_object").slice(before);
        expect(reads.some((c) => c.args.versionId === "v2")).toBe(true);
        expect(reads.every((c) => c.args.versionId === "v2" || c.args.versionId === "null")).toBe(
          true,
        );
        expect(reads.length).toBeLessThanOrEqual(18);
        expect(samples[4]).toBeLessThan(1000);
        expect(samples[8]).toBeLessThan(3000);
        console.log(
          `${engine.name()} S3 version switches: reads=${reads.length} median=${samples[4].toFixed(1)}ms p95=${samples[8].toFixed(1)}ms`,
        );

        await details.getByRole("tab", { name: "Eigenschaften & Metadaten" }).click();
        await details.getByText("Prüfsumme (ETag)", { exact: true }).waitFor();
        expect(last("s3_head_object")?.versionId).toBe("null");
        await details.getByRole("tab", { name: "Tags", exact: true }).click();
        const value = details.getByRole("textbox", { name: "Wert" });
        await value.waitFor();
        expect(await value.inputValue()).toBe("archiv");
        await value.fill("geändert");
        await details.getByRole("button", { name: "Tags speichern" }).click();
        await tagSaved.promise;
        expect(last("s3_put_config")?.versionId).toBe("null");
        expect([...tags]).toEqual([
          ["v2", "aktuell"],
          ["null", "geändert"],
        ]);
        await details.getByRole("tab", { name: "Sperre & Aufbewahrung" }).click();
        await details.getByText("Keine Aufbewahrung gesetzt.").waitFor();
        const lockReads = calls.filter((c) =>
          ["retention", "legal-hold"].includes(c.args.resource ?? ""),
        );
        expect(lockReads.map((c) => c.args.versionId)).toEqual(["null", "null"]);

        await details.getByRole("tab", { name: "Teilen (Presigned URL)" }).click();
        const generate = details.getByRole("button", { name: "URL erzeugen" });
        await generate.click();
        const link = details.getByRole("textbox", { name: "Presigned URL" });
        await link.waitFor();
        expect(new URL(await link.inputValue()).searchParams.get("versionId")).toBe("null");
        await details.getByRole("combobox").first().click();
        await page.getByRole("option", { name: "Hochladen (PUT)" }).click();
        await generate.click();
        await link.waitFor();
        expect(last("s3_presign")).toMatchObject({ method: "PUT", versionId: null });
        expect(new URL(await link.inputValue()).searchParams.has("versionId")).toBe(false);
        await oldRow.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Im Browser öffnen" }).click();
        await opened.promise;
        expect(last("s3_presign")).toMatchObject({ method: "GET", versionId: "null" });
        expect(last("plugin:opener|open_url")?.url).toContain("versionId=null");
      } finally {
        await browser.close();
      }
    },
    45_000,
  );
}
