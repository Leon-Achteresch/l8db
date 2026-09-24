import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { ASSET_BASE, clipTag } from "../../src/lib/feature-videos/model";
import { seedApp } from "../../tests/fixtures/perf-app";

const output = resolve(process.env.FEATURE_VIDEO_OUTPUT ?? "test-artifacts/feature-videos");
const catalog = JSON.parse(await readFile(new URL("catalog.json", import.meta.url), "utf8"));
const requested: string[] = process.env.FEATURE_VIDEO_IDS
  ? JSON.parse(process.env.FEATURE_VIDEO_IDS)
  : catalog.map((item: { id: string }) => item.id);
const selected = catalog.filter((item: { id: string }) => requested.includes(item.id));
if (selected.length !== requested.length) throw new Error("Unbekanntes Aufnahmeszenario");
const root = resolve("dist");
if (!(await Bun.file(resolve(root, "index.html")).exists())) throw new Error("App zuerst bauen");
await mkdir(output, { recursive: true });
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = resolve(root, `.${new URL(request.url).pathname}`);
    if (!path.startsWith(`${root}/`) && path !== root) return new Response(null, { status: 403 });
    const file = Bun.file(path);
    return new Response(
      (await file.exists()) && path !== root ? file : Bun.file(resolve(root, "index.html")),
    );
  },
});
const browser = await chromium.launch();
const rendered = [];

async function caption(page: Page, value: string) {
  await page.evaluate((text) => {
    let label = document.getElementById("demo-caption");
    if (!label) {
      label = document.createElement("div");
      label.id = "demo-caption";
      label.style.cssText =
        "position:fixed;bottom:52px;left:50%;transform:translateX(-50%);z-index:20000000;max-width:900px;background:#171717f2;color:white;border:1px solid #555;border-radius:16px;padding:16px 28px;font:600 34px/1.15 system-ui;text-align:center;white-space:normal;pointer-events:none;box-shadow:0 8px 28px #0008";
      document.body.append(label);
    }
    label.textContent = text;
  }, value);
}

try {
  for (const item of selected) {
    const rawDir = resolve(output, "raw", item.id);
    await mkdir(rawDir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
      colorScheme: "dark",
    });
    const recordingStart = performance.now();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seedApp(page, 8);
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
      localStorage.setItem(
        "l8db.settings",
        JSON.stringify({ ...saved, state: { ...saved.state, autoFeatureVideos: false } }),
      );
    });
    await page.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 404, body: "{}" }),
    );
    if (item.id === "extension-market") {
      const packageBytes = await readFile(resolve("extention/l8db.jev-1.0.0.l8db-extension"));
      const manifest = JSON.parse(packageBytes.toString("utf8")).manifest as {
        id: string;
        name: string;
        description: string;
        version: string;
        publisher: string;
      };
      const market = {
        schemaVersion: 1,
        extensions: [
          {
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            publisher: manifest.publisher,
            package: "packages/l8db.jev-1.0.0.l8db-extension",
            sha256: createHash("sha256").update(packageBytes).digest("hex"),
          },
        ],
      };
      await page.route(
        "https://raw.githubusercontent.com/Leon-Achteresch/l8db-extension-market/main/**",
        (route) =>
          route.fulfill(
            route.request().url().endsWith("/catalog.json")
              ? { json: market, headers: { "Access-Control-Allow-Origin": "*" } }
              : { body: packageBytes, headers: { "Access-Control-Allow-Origin": "*" } },
          ),
      );
    }
    const tab = item.id === "easy-mode" ? "general" : "extensions";
    await page.goto(`http://localhost:${server.port}/settings?tab=${tab}`);
    await page.getByRole("heading", { name: "Einstellungen", exact: true }).waitFor();
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await page.waitForTimeout(1000);
    const trimStart = (performance.now() - recordingStart) / 1000;
    let camera = { scale: 1, x: 0, y: 0 };
    const focus = async (
      target: Locator,
      scale: number,
      center = { x: 640, y: 260 },
      text = false,
    ) => {
      const box = text
        ? await target.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rect = range.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          })
        : await target.boundingBox();
      if (!box) throw new Error(`Zoom-Ziel für ${item.id} fehlt`);
      const targetX = (box.x + box.width / 2 - camera.x) / camera.scale;
      const targetY = (box.y + box.height / 2 - camera.y) / camera.scale;
      camera = {
        scale,
        x: Math.max(1280 - 1280 * scale, Math.min(0, center.x - targetX * scale)),
        y: Math.max(720 - 720 * scale, Math.min(0, center.y - targetY * scale)),
      };
      await page.evaluate(({ scale, x, y }) => {
        const root = document.getElementById("root");
        if (!root) throw new Error("App-Wurzel fehlt");
        root.style.transformOrigin = "top left";
        root.style.transition = "transform 850ms cubic-bezier(0.22, 1, 0.36, 1)";
        root.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      }, camera);
    };
    const resetCamera = async () => {
      camera = { scale: 1, x: 0, y: 0 };
      await page.evaluate(() => {
        const root = document.getElementById("root");
        if (!root) throw new Error("App-Wurzel fehlt");
        root.style.transform = "none";
      });
      await page.waitForTimeout(900);
    };
    const clickVisible = async (target: Locator) => {
      const box = await target.boundingBox();
      if (!box) throw new Error(`Klickziel für ${item.id} fehlt`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (x < 0 || x >= 1280 || y < 0 || y >= 720)
        throw new Error(
          `Klickziel für ${item.id} liegt außerhalb des Bildes: ${target} (${Math.round(x)}, ${Math.round(y)})`,
        );
      await page.mouse.click(x, y);
    };
    if (item.id === "easy-mode") {
      const control = page.getByRole("switch", { name: "Easy Mode", exact: true });
      const navigation = page.getByRole("navigation", { name: "Bereiche" });
      await control.waitFor();
      const before = await navigation.getByRole("link").count();
      await caption(page, "Easy Mode blendet Profi-Werkzeuge aus.");
      await focus(page.getByText("Easy Mode", { exact: true }), 3, undefined, true);
      await page.waitForTimeout(2600);
      await caption(page, "Vorher: Monitor, Vergleich und weitere Bereiche.");
      await focus(navigation, 2.6);
      await page.waitForTimeout(2400);
      await caption(page, "Easy Mode einschalten.");
      await focus(control, 3.3);
      await page.waitForTimeout(1200);
      await clickVisible(control);
      if ((await control.getAttribute("aria-checked")) !== "true")
        throw new Error("Easy Mode wurde nicht aktiviert");
      const after = await navigation.getByRole("link").count();
      if (after >= before) throw new Error("Easy Mode hat die Navigation nicht vereinfacht");
      await page.waitForTimeout(1500);
      await caption(page, "Danach: Dashboard, SQL und Query Builder bleiben.");
      await focus(navigation, 2.6);
      await page.waitForTimeout(4100);
    } else if (item.id === "extension-market") {
      const section = page.getByRole("region", { name: "Extension-Markt", exact: true });
      const packageCard = section.locator("article").first();
      await packageCard.waitFor();
      await caption(page, "Offizielle Erweiterungen im Katalog entdecken.");
      await focus(packageCard.getByText("Jev Plan-Diagnose"), 3, undefined, true);
      await page.waitForTimeout(3000);
      const install = packageCard.getByRole("button", { name: "Installieren" });
      await caption(page, "Installieren lädt und prüft das Paket.");
      await focus(install, 3.3);
      await page.waitForTimeout(1400);
      await clickVisible(install);
      await packageCard.getByRole("button", { name: "Installiert" }).waitFor();
      const community = page.getByRole("region", { name: "Community Extensions" });
      const installed = community.locator("article").first();
      await installed.waitFor();
      await caption(page, "Neu installiert, zunächst deaktiviert.");
      await focus(installed.getByText("Jev Plan-Diagnose"), 2.9, undefined, true);
      await page.waitForTimeout(2600);
      const network = installed.getByLabel("network", { exact: true });
      const storage = installed.getByLabel("filesystem:extension-storage", { exact: true });
      await caption(page, "Berechtigungen vor der Aktivierung freigeben.");
      await resetCamera();
      await network.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await focus(network, 2.8, { x: 480, y: 260 });
      await page.waitForTimeout(1300);
      await clickVisible(network);
      await clickVisible(storage);
      if (!(await network.isChecked()) || !(await storage.isChecked()))
        throw new Error("Berechtigungen wurden nicht gewählt");
      await page.waitForTimeout(1300);
      const activate = installed.getByRole("button", { name: "Aktivieren" });
      await caption(page, "Erst nach deiner Freigabe wird sie aktiviert.");
      await focus(activate, 3.1);
      await page.waitForTimeout(1000);
      await clickVisible(activate);
      await installed.getByText(/· Aktiviert$/).waitFor();
      await caption(page, "Die Erweiterung ist jetzt aktiviert.");
      await focus(installed.getByText("Jev Plan-Diagnose"), 2.9, undefined, true);
      await page.waitForTimeout(2600);
    }
    if (errors.length) throw new Error(`App-Fehler während Aufnahme: ${errors.join("; ")}`);
    const duration = Math.min(25, (performance.now() - recordingStart) / 1000 - trimStart);
    const video = page.video();
    await context.close();
    const raw = await video?.path();
    if (!raw) throw new Error("Aufnahme fehlt");
    const prefix = `fv-${item.id}-${item.revision}`;
    const encode = (extension: string, options: string[]) => {
      const path = resolve(output, `${prefix}.${extension}`);
      execFileSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          trimStart.toFixed(3),
          "-i",
          raw,
          "-t",
          duration.toFixed(3),
          "-an",
          "-vf",
          "scale=1280:720",
          ...options,
          path,
        ],
        { stdio: "inherit" },
      );
      return path;
    };
    const mp4 = encode("mp4", [
      "-c:v",
      "libx264",
      "-crf",
      "24",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "24",
      "-movflags",
      "+faststart",
    ]);
    const webm = encode("webm", [
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "31",
      "-b:v",
      "0",
      "-row-mt",
      "1",
      "-r",
      "24",
    ]);
    const poster = resolve(output, `${prefix}.jpg`);
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "1",
      "-i",
      mp4,
      "-frames:v",
      "1",
      "-vf",
      "scale=960:-1",
      "-q:v",
      "5",
      poster,
    ]);
    const info = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "quiet", "-show_format", "-show_streams", "-of", "json", mp4],
        { encoding: "utf8" },
      ),
    );
    if (info.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio"))
      throw new Error("Audiospur ist nicht erlaubt");
    const sources = await Promise.all(
      [mp4, webm].map(async (path) => {
        const bytes = (await stat(path)).size;
        if (bytes > 5_000_000) throw new Error("Video überschreitet 5 MB");
        const extension = path.endsWith("mp4") ? "mp4" : "webm";
        return {
          url: `${ASSET_BASE}${clipTag(item)}/${prefix}.${extension}`,
          type: `video/${extension}`,
          bytes,
        };
      }),
    );
    if ((await stat(poster)).size > 100_000) throw new Error("Poster überschreitet 100 KB");
    rendered.push({
      ...item,
      sources,
      poster: `${ASSET_BASE}${clipTag(item)}/${prefix}.jpg`,
      durationSeconds: Number(info.format.duration),
    });
    await rm(rawDir, { recursive: true, force: true });
    process.stdout.write(
      `${item.id}: ${info.format.duration}s, ${sources.map((source) => `${source.bytes} Bytes`).join(" / ")}\n`,
    );
  }
  await writeFile(
    resolve(output, "rendered.json"),
    JSON.stringify(
      {
        dirty: Boolean(
          execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
            encoding: "utf8",
          }).trim(),
        ),
        commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        items: rendered,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.stop(true);
}
