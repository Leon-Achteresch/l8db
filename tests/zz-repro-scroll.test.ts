import { test } from "bun:test";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test("repro", async () => {
  const root = resolve("dist");
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = resolve(root, `.${new URL(request.url).pathname}`);
      const file = Bun.file(path);
      return new Response(path !== root && (await file.exists()) ? file : Bun.file(resolve(root, "index.html")));
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seedApp(page, 2, { rows: 2, columns: 2 });
    await page.addInitScript(() => {
      const stored = JSON.parse(localStorage.getItem("l8db.connections") ?? "{}");
      stored.state.connections.push({ id: "target", name: "target", kind: "postgres", connectionString: "postgresql://leon@localhost:5432/l8db_target", sslMode: "disable" });
      localStorage.setItem("l8db.connections", JSON.stringify(stored));
      const left = { connectionId: "perf", database: "l8db_perf", schema: "public", objectType: "view", objectName: "v_table_0000", objectOid: null };
      localStorage.setItem("l8db.table-tabs", JSON.stringify({ version: 4, state: { tabsByConnection: { perf: [{ kind: "tool", tool: "compare", id: "three", title: "Vergleich v_table_0000", compare: { left, right: { ...left, connectionId: "target", database: "l8db_target" }, draft: null, onlyDifferences: false, showDraft: true, syncScroll: true } }] } } }));
      const host = window as any;
      const common = Array.from({ length: 80 }, (_, i) => `  col_${i},`).join("\n");
      const definitions: Record<string, string> = {
        source: `SELECT\n${common}\n${Array.from({ length: 30 }, (_, i) => `  extra_${i},`).join("\n")}\n  last\nFROM items`,
        target: `SELECT\n${common}\n  last\nFROM items`,
      };
      const original = host.__TAURI_INTERNALS__.invoke;
      host.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
        const side = String(args?.connectionString ?? "").includes("l8db_target") ? "target" : "source";
        if (command === "get_view_definition") return definitions[side];
        return original(command, args);
      };
    });
    await page.goto(`http://localhost:${server.port}/compare`);
    await page.getByRole("button", { name: "Vergleich v_table_0000", exact: true }).click();
    await page.getByText("Definitionen werden geladen…").waitFor({ state: "hidden" });
    await page.waitForTimeout(1000);
    const first = (sel: string) => page.evaluate((sel) => {
      const nums = [...document.querySelectorAll(`${sel} .line-numbers`)].map((n) => ({ n: Number(n.textContent), top: n.parentElement!.getBoundingClientRect().top })).filter((x) => x.n).sort((a, b) => a.top - b.top);
      return nums[0]?.n;
    }, sel);
    const state = async (label: string) => console.log(label, "quelle", await first(".definition-diff-editor .editor.original"), "ziel", await first(".definition-diff-editor .editor.modified"), "draft", await first(".merge-draft-editor"));
    const diffBox = (await page.locator(".definition-diff-editor .editor.modified").boundingBox())!;
    const draftBox = (await page.locator(".merge-draft-editor").boundingBox())!;
    const wheel = async (box: any, dy: number) => { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); for (let i = 0; i < Math.abs(dy) / 100; i++) { await page.mouse.wheel(0, Math.sign(dy) * 100); await page.waitForTimeout(40); } await page.waitForTimeout(400); };
    await wheel(diffBox, 600); await state("before: ziel scrolled");
    await wheel(draftBox, 300); await state("before: draft scrolled");
    await wheel(diffBox, 5000); await state("ziel bottom"); await page.screenshot({ path: "/tmp/repro1.png" });
    const glyph = page.getByRole("button", { name: "Quelle in Entwurf übernehmen" });
    console.log("glyphs", await page.locator(".definition-diff-editor .editor.original .merge-hunk-apply").count());
    await glyph.click(); await page.screenshot({ path: "/tmp/repro2.png" });
    await page.waitForTimeout(800);
    await state("after apply");
    await wheel(diffBox, -600); await state("after: ziel up"); console.log(JSON.stringify(await page.evaluate(() => [...(window as any).__sg.editors].map(([e, r]: any) => ({ r, lines: e.getModel().getLineCount(), st: e.getScrollTop(), sh: e.getScrollHeight(), ch: e.getContentHeight(), bot: e.getBottomForLineNumber(e.getModel().getLineCount()), vis: e.getVisibleRanges()[0]?.startLineNumber, vh: e.getLayoutInfo().height })))));
    await wheel(draftBox, -300); await state("after: draft up");
    await wheel(draftBox, -300); await state("after: draft up");
    await wheel(diffBox, -600); await state("after: ziel up");
    await wheel(draftBox, 5000); await state("after: draft bottom");
    await wheel(diffBox, -300); await state("after: ziel up"); await page.screenshot({ path: "/tmp/repro3.png" });
  } finally { await browser.close(); server.stop(true); }
}, 60000);
