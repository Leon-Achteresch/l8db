import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { writeDashboardTourPlayer } from "./dashboard-tour-player";

interface Shot {
  screenshot: string;
  chapter: number;
  title: string;
  detail: string;
  voice: string;
  zoom?: number;
  focus?: [number, number];
}

interface Capture {
  id: string;
  file?: string;
  path: string;
}

interface Segment extends Shot {
  index: number;
  start: number;
  duration: number;
  speechDuration: number;
  image: string;
  layout: string;
  audio: string;
  video: string;
}

const input = process.argv[2];
if (!input) throw new Error("Screenshot-Verzeichnis mit manifest.json als Argument angeben");
const source = resolve(input);
const output = resolve(process.argv[3] ?? "test-artifacts/feature-videos/dashboard-tour");
const work = join(output, "work");
const spec = JSON.parse(
  await readFile(new URL("dashboard-tour.json", import.meta.url), "utf8"),
) as {
  title: string;
  subtitle: string;
  voice: string;
  wordsPerMinute: number;
  chapters: string[];
  shots: Shot[];
};
const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as {
  captures: Capture[];
};
const captures = new Map(manifest.captures.map((capture) => [capture.id, capture]));
const fps = 30;
await mkdir(work, { recursive: true });

function probe(path: string) {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], {
      encoding: "utf8",
    }),
  );
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

function timestamp(seconds: number, separator = ",") {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, "0")}:${String(Math.floor(ms / 60_000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}

const narrations = new Map<number, { audio: string; speechDuration: number }>();
const voiceQueue = [...spec.shots.entries()];
async function prepareVoice() {
  while (voiceQueue.length) {
    const entry = voiceQueue.shift();
    if (!entry) return;
    const [index, shot] = entry;
    const key = new Bun.CryptoHasher("sha256")
      .update(`${spec.voice}|${spec.wordsPerMinute}|${shot.voice}`)
      .digest("hex")
      .slice(0, 12);
    const audio = join(work, `${key}.aiff`);
    const narration = join(work, `${key}.txt`);
    await writeFile(narration, shot.voice);
    const minimum = (shot.voice.split(/\s+/).length / spec.wordsPerMinute) * 60 * 0.65;
    let cached = false;
    if (await Bun.file(audio).exists()) {
      try {
        cached = Number(probe(audio).format.duration) >= minimum;
      } catch {
        cached = false;
      }
    }
    if (!cached) {
      const temporary = join(work, `${key}.partial.aiff`);
      const command = Bun.spawn(
        [
          "say",
          "-v",
          spec.voice,
          "-r",
          String(spec.wordsPerMinute),
          "-f",
          narration,
          "-o",
          temporary,
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      const stderr = await new Response(command.stderr).text();
      if ((await command.exited) !== 0) throw new Error(`Sprechertext fehlgeschlagen: ${stderr}`);
      await rename(temporary, audio);
    }
    narrations.set(index, { audio, speechDuration: Number(probe(audio).format.duration) });
    console.log(`VOICE ${narrations.size}/${spec.shots.length}: ${shot.title}`);
  }
}
await Promise.all(Array.from({ length: 4 }, prepareVoice));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const segments: Segment[] = [];
let total = 0;
try {
  for (const [index, shot] of spec.shots.entries()) {
    const capture = captures.get(shot.screenshot);
    if (!capture) throw new Error(`Screenshot fehlt: ${shot.screenshot}`);
    const image = capture.file ? join(source, capture.file) : capture.path;
    await stat(image);
    const narration = narrations.get(index);
    if (!narration) throw new Error(`Sprechertext fehlt: ${shot.title}`);
    const { audio, speechDuration } = narration;
    const duration = Math.ceil(Math.max(8, speechDuration + 1.6) * fps) / fps;
    const layout = join(work, `${String(index + 1).padStart(2, "0")}-layout.png`);
    await page.setContent(`<!doctype html><html lang="de"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0c131c;color:#f4f8fc;font-family:Arial,sans-serif}
      .header{position:absolute;left:72px;right:72px;top:43px;display:flex;align-items:center;gap:22px;font-size:23px;color:#a4b6c8}.brand{font-size:30px;font-weight:700;color:#f4f8fc}.rule{width:1px;height:27px;background:#334253}.mode{margin-left:auto;font-size:17px;letter-spacing:2px;color:#a4b6c8}
      .rail{position:absolute;left:72px;top:167px;width:371px}.chapter{font-size:18px;font-weight:700;letter-spacing:2px;color:#8ebfff;line-height:1.5;text-transform:uppercase}.accent{width:56px;height:5px;border-radius:3px;background:#8ebfff;margin:25px 0 27px}h1{margin:0;font-size:45px;font-weight:700;line-height:1.12;letter-spacing:-1px;text-wrap:balance}.detail{margin:29px 0 0;font-size:26px;line-height:1.5;color:#c3d0dc;text-wrap:pretty}.count{position:absolute;left:72px;bottom:137px;font-size:19px;line-height:1.65;color:#90a4b8}.count strong{font-size:28px;color:#e8f1fb;font-weight:500}.panel{position:absolute;left:498px;top:134px;width:1356px;height:852px;border:1px solid #45576a;background:#1c2b3c;box-shadow:0 20px 45px #0005}
      .footer{position:absolute;left:72px;right:72px;bottom:37px;display:flex;justify-content:space-between;font-size:18px;color:#94a9bc}.track{position:absolute;left:72px;right:72px;bottom:18px;height:3px;background:#253547}.progress{height:3px;width:${((index + 1) / spec.shots.length) * 100}%;background:#8ebfff}
      </style><div class="header"><span class="brand">l8db</span><span class="rule"></span><span>Dashboard · Feature-Tour</span><span class="mode">DEUTSCH · BEISPIELDATEN</span></div>
      <div class="rail"><div class="chapter">${String(shot.chapter + 1).padStart(2, "0")} / ${escapeHtml(spec.chapters[shot.chapter])}</div><div class="accent"></div><h1>${escapeHtml(shot.title)}</h1><p class="detail">${escapeHtml(shot.detail)}</p></div>
      <div class="count"><strong>${String(index + 1).padStart(2, "0")}</strong> / ${spec.shots.length} Szenen<br>49 Screenshots · 16 Charttypen</div><div class="panel"></div>
      <div class="footer"><span>Verstehen. Gestalten. Auswerten.</span><span>${escapeHtml(spec.subtitle)}</span></div><div class="track"><div class="progress"></div></div></html>`);
    await page.evaluate(async () => await document.fonts.ready);
    await page.screenshot({ path: layout, animations: "disabled" });
    segments.push({
      ...shot,
      index,
      start: total,
      duration,
      speechDuration,
      image,
      layout,
      audio,
      video: join(work, `${String(index + 1).padStart(2, "0")}.mp4`),
    });
    total += duration;
    console.log(
      `PREPARE ${index + 1}/${spec.shots.length}: ${shot.title} (${duration.toFixed(1)}s)`,
    );
  }
} finally {
  await browser.close();
}

let completed = 0;
const queue = [...segments];
async function encode() {
  while (queue.length) {
    const segment = queue.shift();
    if (!segment) return;
    const sourceVideo = probe(segment.image).streams.find(
      (stream: { codec_type: string }) => stream.codec_type === "video",
    );
    const preserveAspect = sourceVideo.width / sourceVideo.height !== 1.6;
    const signature = join(work, `${segment.index + 1}-signature.json`);
    const identity = `${JSON.stringify(segment)}${preserveAspect ? "|contain-v1" : ""}`;
    if (
      (await Bun.file(segment.video).exists()) &&
      (await Bun.file(signature)
        .text()
        .catch(() => "")) === identity
    ) {
      completed += 1;
      console.log(`CACHED ${completed}/${segments.length}: ${segment.title}`);
      continue;
    }
    const zoom = segment.zoom ?? (segment.screenshot.startsWith("chart-") ? 1.3 : 1.12);
    const [x, y] = segment.focus ?? [0.52, 0.57];
    const easing = `(0.5-0.5*cos(PI*min(1,max(0,(on/${fps}-1)/2.5))))`;
    const camera = `zoompan=z='1+${zoom - 1}*${easing}':x='max(0,min(iw-iw/zoom,iw*${x}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*${y}-ih/zoom/2))':d=${Math.round(segment.duration * fps)}:s=1344x840:fps=${fps}`;
    const fit = preserveAspect
      ? "scale=1600:1000:force_original_aspect_ratio=decrease,pad=1600:1000:(ow-iw)/2:(oh-ih)/2:color=0x0c131c,"
      : "";
    const command = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-i",
        segment.layout,
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-i",
        segment.image,
        "-i",
        segment.audio,
        "-filter_complex",
        `[1:v]${fit}${camera}[ui];[0:v][ui]overlay=504:140:shortest=1[v];[2:a]adelay=700|700,apad[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        String(segment.duration),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(fps),
        "-threads",
        "4",
        "-filter_complex_threads",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        segment.video,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const stderr = await new Response(command.stderr).text();
    if ((await command.exited) !== 0) throw new Error(`Renderfehler ${segment.title}: ${stderr}`);
    await writeFile(signature, identity);
    completed += 1;
    console.log(`RENDER ${completed}/${segments.length}: ${segment.title}`);
  }
}
await Promise.all(
  Array.from({ length: Number(process.env.DASHBOARD_RENDER_WORKERS ?? "3") }, encode),
);

const chapters = spec.chapters.map((title, index) => {
  const shots = segments.filter((segment) => segment.chapter === index);
  const first = shots[0];
  const last = shots.at(-1);
  if (!first || !last) throw new Error(`Kapitel ohne Szenen: ${title}`);
  return { title, start: first.start, end: last.start + last.duration };
});
const metadata = `;FFMETADATA1\ntitle=${spec.title}\ncomment=49 echte Screenshots mit isolierten Beispieldaten und simulierten Abfragezuständen\n${chapters.map((chapter) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.start * 1000)}\nEND=${Math.round(chapter.end * 1000)}\ntitle=${chapter.title}\n`).join("")}`;
const cues: { start: number; end: number; text: string }[] = [];
for (const segment of segments) {
  const sentences = segment.voice.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) ?? [
    segment.voice,
  ];
  const chunks = sentences.flatMap((sentence) => {
    const words = sentence.split(" ");
    const groups: string[] = [];
    let line = "";
    for (const word of words) {
      if (`${line} ${word}`.trim().length > 102 && line) {
        groups.push(line);
        line = word;
      } else line = `${line} ${word}`.trim();
    }
    if (line) groups.push(line);
    return groups;
  });
  const words = chunks.reduce((sum, chunk) => sum + chunk.split(" ").length, 0);
  let cursor = segment.start + 0.7;
  for (const text of chunks) {
    const duration = (text.split(" ").length / words) * segment.speechDuration;
    cues.push({ start: cursor, end: cursor + duration, text });
    cursor += duration;
  }
}
const srt = cues
  .map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`)
  .join("\n");
const vtt = `WEBVTT\n\n${cues.map((cue) => `${timestamp(cue.start, ".")} --> ${timestamp(cue.end, ".")}\n${cue.text}\n`).join("\n")}`;
await writeFile(join(output, "dashboard-tour.de.srt"), srt);
await writeFile(join(output, "dashboard-tour.de.vtt"), vtt);
await writeFile(join(work, "chapters.ffmeta"), metadata);
await writeFile(
  join(work, "concat.txt"),
  segments.map((segment) => `file '${segment.video.replaceAll("'", "'\\''")}'`).join("\n"),
);
const movie = join(output, "dashboard-feature-tour.mp4");
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  join(work, "concat.txt"),
  "-i",
  join(work, "chapters.ffmeta"),
  "-i",
  join(output, "dashboard-tour.de.srt"),
  "-map",
  "0:v",
  "-map",
  "0:a",
  "-map",
  "2:0",
  "-map_metadata",
  "1",
  "-map_chapters",
  "1",
  "-c:v",
  "copy",
  "-c:a",
  "copy",
  "-c:s",
  "mov_text",
  "-metadata:s:s:0",
  "language=deu",
  "-metadata:s:a:0",
  "language=deu",
  "-movflags",
  "+faststart",
  movie,
]);
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-ss",
  "3.8",
  "-i",
  movie,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(output, "dashboard-feature-tour.jpg"),
]);
const info = probe(movie);
const video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
if (
  video.width !== 1920 ||
  video.height !== 1080 ||
  !info.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio")
)
  throw new Error("Exportformat stimmt nicht");
if (Math.abs(Number(info.format.duration) - total) > 2) throw new Error("Exportdauer stimmt nicht");
await writeFile(
  join(output, "tour-manifest.json"),
  JSON.stringify(
    {
      title: spec.title,
      durationSeconds: Number(info.format.duration),
      screenshots: captures.size,
      scenes: segments.length,
      chapters,
      shots: segments.map(({ audio: _a, layout: _l, video: _v, ...segment }) => segment),
      voice: {
        name: spec.voice,
        type: "macOS-Sprachsynthese",
        wordsPerMinute: spec.wordsPerMinute,
      },
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    },
    null,
    2,
  ),
);
await writeFile(
  join(output, "chapters.txt"),
  chapters
    .map((chapter) => `${timestamp(chapter.start, ".").slice(0, 8)} ${chapter.title}`)
    .join("\n"),
);
await writeFile(
  join(output, "script.txt"),
  segments
    .map(
      (segment) =>
        `${timestamp(segment.start, ".").slice(0, 8)} · ${segment.title}\n${segment.voice}\n`,
    )
    .join("\n"),
);
await writeDashboardTourPlayer(output);
console.log(
  `DONE ${movie}: ${Number(info.format.duration).toFixed(1)}s, ${segments.length} scenes, ${(Number(info.format.size) / 1_000_000).toFixed(1)} MB`,
);
