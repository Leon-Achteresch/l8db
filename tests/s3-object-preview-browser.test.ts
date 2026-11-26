import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const appUrl = process.env.L8DB_S3_PREVIEW_BROWSER_URL;
interface ReadRequest {
  key: string;
  versionId: string | null;
  maxBytes: number;
}
for (const engine of [chromium, webkit]) {
  test.skipIf(!appUrl)(
    `${engine.name()}: S3 previews read only displayed ranges and keep the object version`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(10000);
        const image = Buffer.from(
          await Bun.file(new URL("../src-tauri/icons/128x128.png", import.meta.url)).arrayBuffer(),
        );
        const text = Buffer.from(`${"Zeile\n".repeat(5000)}Letzte Zeile`);
        const sizes = {
          "huge.jpg": 32 * 1024 * 1024,
          "report.pdf": 4 * 1024 * 1024,
          picture: image.length,
          "updated.png": 32 * 1024 * 1024,
          notes: text.length,
        };
        const reads: ReadRequest[] = [];
        await seedApp(page, 1);
        await page.exposeFunction(
          "readPreviewRange",
          ({ key, maxBytes, versionId }: ReadRequest) => {
            reads.push({ key, maxBytes, versionId });
            const png = key === "picture" || key === "updated.png";
            const size = png ? image.length : sizes[key as keyof typeof sizes];
            const bytes = png
              ? image.subarray(0, maxBytes)
              : key === "notes"
                ? text.subarray(0, maxBytes)
                : Buffer.alloc(Math.min(size, maxBytes), 65);
            return {
              content_type: png
                ? "image/png"
                : key === "report.pdf"
                  ? "application/pdf"
                  : key === "notes"
                    ? "text/plain"
                    : "image/jpeg",
              data: bytes.toString("base64"),
              size,
              truncated: bytes.length < size,
            };
          },
        );
        await page.addInitScript((sizes) => {
          const key = "l8db.connections";
          const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
          Object.assign(saved.state.connections[0], {
            kind: "s3",
            connectionString: "s3://preview",
          });
          localStorage.setItem(key, JSON.stringify(saved));
          const scope = window as unknown as {
            readPreviewRange(args: ReadRequest): Promise<unknown>;
            __TAURI_INTERNALS__: { invoke(command: string, args?: ReadRequest): Promise<unknown> };
          };
          const bridge = scope.__TAURI_INTERNALS__;
          const invoke = bridge.invoke;
          bridge.invoke = async (command, args) => {
            if (command === "s3_list_buckets") return [{ name: "sample", creation_date: null }];
            if (command === "s3_get_config") return null;
            const objects = Object.entries(sizes).map(([key, size]) => ({
              key,
              size,
              storage_class: "STANDARD",
              etag: null,
              last_modified: null,
            }));
            if (command === "s3_list_objects")
              return { objects, prefixes: [], truncated: false, next_token: null };
            if (command === "s3_list_object_versions")
              return {
                versions: objects.map((o) => ({
                  ...o,
                  version_id: "v2",
                  is_latest: true,
                  delete_marker: false,
                })),
                prefixes: [],
                truncated: false,
                next_key_marker: null,
                next_version_marker: null,
              };
            if (command === "s3_preview_object" && args) return scope.readPreviewRange(args);
            return invoke(command, args);
          };
        }, sizes);
        await page.goto(`${appUrl}/buckets/sample`);
        const open = (key: string) =>
          page.locator(`tr[data-key="${key}"]`).getByText(key, { exact: true }).click();
        const details = page.getByRole("complementary", { name: "Objektdetails" });
        await open("huge.jpg");
        await details.getByText(/Bild ist zu groß/).waitFor();
        expect(await details.getByRole("img").count()).toBe(0);
        await open("report.pdf");
        await details.getByText(/erste 2.0 KB als Hex angezeigt/).waitFor();
        expect((await details.locator("pre").innerText()).split("\n")).toHaveLength(128);
        await open("picture");
        const load = details.getByRole("button", { name: /Bildvorschau laden/ });
        await load.waitFor();
        expect(await details.getByRole("img").count()).toBe(0);
        await load.click();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLImageElement>('img[alt="picture"]')?.naturalWidth === 128,
        );
        await open("notes");
        await details.getByRole("button", { name: "Mehr laden" }).click();
        await details.locator("pre").filter({ hasText: "Letzte Zeile" }).waitFor();
        expect(await details.getByRole("button", { name: "Mehr laden" }).count()).toBe(0);
        await page.getByRole("button", { name: "Versionen anzeigen" }).click();
        await open("updated.png");
        await load.click();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLImageElement>('img[alt="updated.png"]')?.naturalWidth ===
            128,
        );
        expect(reads).toEqual([
          { key: "huge.jpg", maxBytes: 2048, versionId: null },
          { key: "report.pdf", maxBytes: 2048, versionId: null },
          { key: "picture", maxBytes: 2048, versionId: null },
          { key: "picture", maxBytes: image.length, versionId: null },
          { key: "notes", maxBytes: 2048, versionId: null },
          { key: "notes", maxBytes: text.length, versionId: null },
          { key: "updated.png", maxBytes: 2048, versionId: "v2" },
          { key: "updated.png", maxBytes: image.length, versionId: "v2" },
        ]);
      } finally {
        await browser.close();
      }
    },
    45000,
  );
}
