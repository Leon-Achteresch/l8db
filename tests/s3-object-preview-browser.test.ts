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
          "document.txt": text.length,
        };
        const reads: ReadRequest[] = [];
        let documentPreviews = 0;
        let editorReads = 0;
        let writes = 0;
        await seedApp(page, 1);
        await page.exposeFunction("readEditorText", () => {
          editorReads++;
          if (editorReads === 1 || editorReads === 3)
            throw new Error("Der Speicher hat das Objekt nur teilweise geliefert.");
          return editorReads === 2 ? "Vollständiger Text" : "Neue Fassung";
        });
        await page.exposeFunction("writeEditorText", () => {
          writes++;
          throw new Error("PreconditionFailed");
        });
        await page.exposeFunction(
          "readPreviewRange",
          ({ key, maxBytes, versionId }: ReadRequest) => {
            reads.push({ key, maxBytes, versionId });
            if (key === "document.txt" && ++documentPreviews === 1)
              throw new Error("Speicher vorübergehend nicht erreichbar.");
            const png = key === "picture" || key === "updated.png";
            const plain = key === "notes" || key === "document.txt";
            const size = png ? image.length : sizes[key as keyof typeof sizes];
            const bytes = png
              ? image.subarray(0, maxBytes)
              : plain
                ? text.subarray(0, maxBytes)
                : Buffer.alloc(Math.min(size, maxBytes), 65);
            return {
              content_type: png
                ? "image/png"
                : key === "report.pdf"
                  ? "application/pdf"
                  : plain
                    ? "text/plain"
                    : "image/jpeg",
              data: bytes.toString("base64"),
              size: (key === "picture" || key === "notes") && bytes.length < size ? null : size,
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
            readEditorText(): Promise<string>;
            writeEditorText(): Promise<void>;
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
              etag: "first",
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
            if (command === "s3_get_object_text") return scope.readEditorText();
            if (command === "s3_head_object") return { etag: "second" };
            if (command === "s3_put_object_text") return scope.writeEditorText();
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
        await details.getByText(/Größe unbekannt/).waitFor();
        expect(await details.getByRole("img").count()).toBe(0);
        await load.click();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLImageElement>('img[alt="picture"]')?.naturalWidth === 128,
        );
        await open("notes");
        await details.getByText(/Größe unbekannt.*erste 2.0 KB geladen/).waitFor();
        await details.getByRole("button", { name: "Mehr laden" }).click();
        await details.locator("pre").filter({ hasText: "Letzte Zeile" }).waitFor();
        expect(await details.getByRole("button", { name: "Mehr laden" }).count()).toBe(0);
        await open("document.txt");
        await details.getByRole("alert").waitFor();
        expect(documentPreviews).toBe(1);
        await details.getByRole("button", { name: /Erneut versuchen/ }).click();
        await details.locator("pre").filter({ hasText: "Letzte Zeile" }).waitFor();
        await details.getByRole("button", { name: "Inhalt bearbeiten" }).click();
        const editor = page.getByRole("dialog");
        await editor.getByRole("alert").filter({ hasText: "nur teilweise geliefert" }).waitFor();
        expect(editorReads).toBe(1);
        expect(await editor.getByRole("button", { name: "Speichern" }).isDisabled()).toBe(true);
        expect(await editor.getByRole("textbox").count()).toBe(0);
        await editor.getByRole("button", { name: /Erneut versuchen/ }).click();
        const input = editor.getByRole("textbox", { name: "Objektinhalt" });
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Objektinhalt"]')
              ?.value === "Vollständiger Text",
        );
        expect(await input.inputValue()).toBe("Vollständiger Text");
        expect(editorReads).toBe(2);
        expect(writes).toBe(0);
        await input.fill("Lokaler Entwurf");
        await editor.getByRole("button", { name: "Speichern" }).click();
        await editor.getByRole("button", { name: "Neu laden" }).click();
        await editor.getByRole("alert").filter({ hasText: "nur teilweise geliefert" }).waitFor();
        expect(await editor.getByRole("button", { name: "Speichern" }).isDisabled()).toBe(true);
        expect(await editor.getByRole("button", { name: "Trotzdem überschreiben" }).count()).toBe(
          0,
        );
        await editor.getByRole("button", { name: /Erneut versuchen/ }).click();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Objektinhalt"]')
              ?.value === "Neue Fassung",
        );
        await editor.getByRole("button", { name: "Abbrechen" }).click();
        expect(editorReads).toBe(4);
        expect(writes).toBe(1);
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
          { key: "picture", maxBytes: 12 * 1024 * 1024, versionId: null },
          { key: "notes", maxBytes: 2048, versionId: null },
          { key: "notes", maxBytes: 256 * 1024, versionId: null },
          { key: "document.txt", maxBytes: 256 * 1024, versionId: null },
          { key: "document.txt", maxBytes: 256 * 1024, versionId: null },
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
