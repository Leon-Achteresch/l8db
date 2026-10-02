import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function writeDashboardTourPlayer(output: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(output, "tour-manifest.json"), "utf8")) as {
    title: string;
    durationSeconds: number;
    chapters: { title: string; start: number; end: number }[];
  };
  const vtt = await readFile(join(output, "dashboard-tour.de.vtt"), "utf8");
  const seconds = (value: string) =>
    value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  const cues = vtt
    .split("\n\n")
    .filter((block) => block.includes(" --> "))
    .map((block) => {
      const [timing, ...lines] = block.split("\n");
      const [start, end] = timing.split(" --> ").map(seconds);
      return { start, end, text: lines.join("\n") };
    });
  const data = JSON.stringify({ ...manifest, cues }).replaceAll("<", "\\u003c");
  await writeFile(
    join(output, "index.html"),
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>l8db · Dashboard Feature-Tour</title><style>
    *{box-sizing:border-box}body{margin:0;background:#0c131c;color:#eff5fb;font:16px system-ui,sans-serif}header{max-width:1440px;margin:auto;padding:28px 24px 20px}h1{font-size:28px;margin:0 0 9px}p{color:#adbed0;line-height:1.55;margin:0}main{max-width:1440px;margin:auto;padding:0 24px 36px}video{width:100%;height:auto;display:block;background:#000;border:1px solid #41546a;border-radius:12px}video::cue{font:24px system-ui;color:white;background:#08111ce6}.links{display:flex;gap:22px;flex-wrap:wrap;padding:18px 0}a{color:#a4caff}h2{font-size:18px;margin:14px 0}nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}button{display:flex;gap:13px;align-items:center;padding:16px;border:1px solid #34475b;background:#152233;color:#eaf3ff;text-align:left;font:15px system-ui;border-radius:9px;cursor:pointer}button:hover,button[aria-current=true]{border-color:#8ebfff;background:#213c5d}.time{color:#8ebfff;font-variant-numeric:tabular-nums;flex:none}button:focus-visible,a:focus-visible{outline:3px solid #8ebfff;outline-offset:3px}.note{font-size:13px;margin-top:20px}@media(max-width:760px){nav{grid-template-columns:1fr}header{padding:20px 16px}main{padding:0 16px 24px}h1{font-size:23px}}
    </style></head><body><header><h1>Aus Daten wird ein Überblick</h1><p id="summary"></p></header><main><video id="video" controls preload="metadata" playsinline poster="dashboard-feature-tour.jpg"><source src="dashboard-feature-tour.mp4" type="video/mp4"></video><div class="links"><a href="dashboard-feature-tour.mp4" download>MP4 herunterladen</a><a href="dashboard-tour.de.srt" download>Deutsche Untertitel</a><a href="script.txt" download>Sprechertext</a><a href="chapters.txt" download>Kapitelübersicht</a></div><h2>Direkt zu einem Kapitel</h2><nav id="chapters" aria-label="Videokapitel"></nav><p class="note">Echte Browser-Screenshots mit isolierten Beispieldaten. Lade-, Leer- und Fehlerzustände sowie Abfrageergebnisse sind simuliert. Deutsche synthetische Sprecherstimme: Anna (macOS). Die Video-Tour läuft vollständig lokal.</p></main><script>
    const data=${data};const video=document.getElementById('video');const nav=document.getElementById('chapters');const time=seconds=>String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(Math.floor(seconds%60)).padStart(2,'0');document.getElementById('summary').textContent=time(data.durationSeconds)+' Minuten · 50 Szenen · 49 Screenshots · 16 Charttypen · Full HD';const track=video.addTextTrack('subtitles','Deutsch','de');data.cues.forEach(cue=>track.addCue(new VTTCue(cue.start,cue.end,cue.text)));track.mode='showing';data.chapters.forEach(chapter=>{const button=document.createElement('button');button.type='button';const stamp=document.createElement('span');stamp.className='time';stamp.textContent=time(chapter.start);button.append(stamp,document.createTextNode(chapter.title));button.onclick=()=>{video.currentTime=chapter.start;video.play().catch(()=>{});video.scrollIntoView({block:'center',behavior:'smooth'});};nav.append(button);});video.addEventListener('timeupdate',()=>data.chapters.forEach((chapter,i)=>nav.children[i].setAttribute('aria-current',String(video.currentTime>=chapter.start&&video.currentTime<chapter.end))));
    </script></body></html>`,
  );
}

if (import.meta.main)
  await writeDashboardTourPlayer(
    resolve(process.argv[2] ?? "test-artifacts/feature-videos/dashboard-tour"),
  );
