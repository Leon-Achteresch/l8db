import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["refactor", "Änderungen"],
];
const SKIP = new Set(["docs", "test", "build", "ci", "style", "chore"]);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function commitsIn(range) {
  const raw = git("log", range, "--pretty=format:%s", "--no-merges");
  return raw ? raw.split("\n").filter(Boolean) : [];
}

function renderSection(title, date, subjects) {
  const grouped = new Map(SECTIONS.map(([type]) => [type, []]));
  const other = [];
  for (const subject of subjects) {
    const match = subject.match(/^([a-z]+)(\([^)]*\))?!?:\s+(.+)$/);
    if (!match) {
      other.push(subject);
      continue;
    }
    const [, type, , message] = match;
    if (grouped.has(type)) grouped.get(type).push(message);
    else if (!SKIP.has(type)) other.push(subject);
  }
  const lines = [`## ${title}${date ? ` - ${date}` : ""}`, ""];
  let hasEntries = false;
  for (const [type, heading] of SECTIONS) {
    const entries = grouped.get(type);
    if (!entries.length) continue;
    hasEntries = true;
    lines.push(`### ${heading}`, ...entries.map((entry) => `- ${entry}`), "");
  }
  if (other.length) {
    hasEntries = true;
    lines.push("### Weitere Änderungen", ...other.map((entry) => `- ${entry}`), "");
  }
  if (!hasEntries) lines.push("- Keine Änderungen.", "");
  return lines.join("\n");
}

const args = process.argv.slice(2);
const nextIndex = args.indexOf("--next");
const next = nextIndex >= 0 ? args[nextIndex + 1] : "";
const releaseBodyOnly = args.includes("--release-body");

const tags = git("tag", "--list", "v*", "--sort=-v:refname")
  .split("\n")
  .filter(Boolean);
const today = new Date().toISOString().slice(0, 10);

const sections = [];
const headCommits = commitsIn(tags[0] ? `${tags[0]}..HEAD` : "HEAD");
if (next) sections.push(renderSection(`[${next}]`, today, headCommits));
else if (headCommits.length) sections.push(renderSection("[Unreleased]", "", headCommits));

tags.forEach((tag, index) => {
  const previous = tags[index + 1];
  const date = git("log", "-1", "--format=%cs", tag);
  sections.push(renderSection(`[${tag.slice(1)}]`, date, commitsIn(previous ? `${previous}..${tag}` : tag)));
});

if (releaseBodyOnly) {
  process.stdout.write(sections[0] ?? "- Keine Änderungen.\n");
} else {
  const header = [
    "# Changelog",
    "",
    "Alle veröffentlichten Änderungen dieser App, automatisch aus der Git-Historie erzeugt.",
    "Nicht von Hand bearbeiten: `bun run changelog` regeneriert diese Datei.",
    "",
  ].join("\n");
  writeFileSync("CHANGELOG.md", `${header}\n${sections.join("\n")}`);
}
