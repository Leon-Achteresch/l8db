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
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const head = option("--head") ?? "HEAD";
const previousTag = option("--previous");

const canary = /^(\d+\.\d+\.\d+)-canary\.\d+$/.exec(next)?.[1];
const tags = git(
  "-c",
  "versionsort.suffix=-",
  "tag",
  ...(canary ? [] : ["--merged", head]),
  "--list",
  "v*",
  "--sort=-v:refname",
)
  .split("\n")
  .filter(
    (tag) =>
      (/^v\d+\.\d+\.\d+$/.test(tag) ||
        (/^v\d+\.\d+\.\d+-canary\.\d+$/.test(tag) && tag.startsWith(`v${canary}-canary.`))) &&
      tag !== `v${next}`,
  );
const today = option("--date") ?? new Date().toISOString().slice(0, 10);

const sections = [];
const previous = previousTag ?? tags[0];
const headCommits = commitsIn(previous ? `${previous}..${head}` : head);
if (next) sections.push(renderSection(`[${next}]`, today, headCommits));
else if (headCommits.length) sections.push(renderSection("[Unreleased]", "", headCommits));

if (releaseBodyOnly) {
  process.stdout.write(sections[0] ?? "- Keine Änderungen.\n");
} else {
  tags.forEach((tag, index) => {
    const previous = tags[index + 1];
    const date = git("log", "-1", "--format=%cs", tag);
    sections.push(
      renderSection(`[${tag.slice(1)}]`, date, commitsIn(previous ? `${previous}..${tag}` : tag)),
    );
  });

  const header = [
    "# Changelog",
    "",
    "Alle veröffentlichten Änderungen dieser App, automatisch aus der Git-Historie erzeugt.",
    "Nicht von Hand bearbeiten: `bun run changelog` regeneriert diese Datei.",
    "",
  ].join("\n");
  writeFileSync("CHANGELOG.md", `${header}\n${sections.join("\n")}`);
}
