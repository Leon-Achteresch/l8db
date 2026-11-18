import { diffLines } from "@/lib/ai/editor/line-diff";
import type { CompareObjectType } from "@/lib/compare-types";
import { versioningRepository } from "@/lib/db";
import { PROJECT_PATH, parseProject } from "./model";
import { readFile } from "./repository";
import type { VersioningProject } from "./types";

export const UNCOMMITTED = "0".repeat(40);
export const ROUTINE_TYPES: CompareObjectType[] = ["routine", "procedure"];
export const PACKAGE_TYPES: CompareObjectType[] = ["package"];

export interface BlameCommit {
  hash: string;
  author: string;
  mail: string;
  time: number;
  summary: string;
}

export interface FileBlame {
  repo: string;
  path: string;
  text: string;
  lines: BlameCommit[];
}

export interface BlameTarget {
  kind: string;
  schema: string;
  name: string;
  types: readonly CompareObjectType[];
  part?: "spec" | "body";
}

export function parseBlame(porcelain: string): { text: string; lines: BlameCommit[] } {
  const commits = new Map<string, BlameCommit>();
  const lines: BlameCommit[] = [];
  const content: string[] = [];
  let current: BlameCommit | null = null;
  let line = 0;
  for (const row of porcelain.split("\n")) {
    if (row.startsWith("\t")) {
      if (current && line > 0) {
        lines[line - 1] = current;
        content[line - 1] = row.slice(1);
      }
      continue;
    }
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
    if (header) {
      current = commits.get(header[1]) ?? {
        hash: header[1],
        author: "",
        mail: "",
        time: 0,
        summary: "",
      };
      commits.set(header[1], current);
      line = Number(header[2]);
      continue;
    }
    if (!current) continue;
    const space = row.indexOf(" ");
    const key = space < 0 ? row : row.slice(0, space);
    const value = space < 0 ? "" : row.slice(space + 1);
    if (key === "author") current.author = value;
    else if (key === "author-mail") current.mail = value.replace(/^<|>$/g, "");
    else if (key === "author-time") current.time = Number(value) * 1000;
    else if (key === "summary") current.summary = value;
  }
  return { text: content.join("\n"), lines };
}

const normalize = (value: string) => {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

function uniqueAnchors(left: string[], right: string[]): [number, number][] {
  const seen = new Map<string, { left: number; right: number; at: number }>();
  left.forEach((line, index) => {
    const entry = seen.get(line);
    if (entry) entry.left++;
    else seen.set(line, { left: 1, right: 0, at: index });
  });
  for (const line of right) {
    const entry = seen.get(line);
    if (entry) entry.right++;
  }
  const pairs: [number, number][] = [];
  right.forEach((line, index) => {
    const entry = seen.get(line);
    if (entry?.left === 1 && entry.right === 1) pairs.push([entry.at, index]);
  });
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([at], index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pairs[tails[middle]][0] < at) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const anchors: [number, number][] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index])
    anchors.push(pairs[index]);
  return anchors.reverse();
}

function mapGap(
  left: string[],
  right: string[],
  oldStart: number,
  newStart: number,
  map: (number | null)[],
) {
  if (!left.length || !right.length) return;
  let oldLine = 0;
  let newLine = 0;
  for (const hunk of diffLines(left.join("\n"), right.join("\n"))) {
    while (newLine < hunk.newStart - 1) map[newStart + newLine++] = oldStart + oldLine++;
    newLine += hunk.newLines.length;
    oldLine += hunk.oldLines.length;
  }
  while (newLine < right.length) map[newStart + newLine++] = oldStart + oldLine++;
}

export function mapLines(file: string, text: string): (number | null)[] {
  const left = normalize(file);
  const right = normalize(text);
  const map: (number | null)[] = new Array(text.replace(/\r\n?/g, "\n").split("\n").length).fill(
    null,
  );
  let oldLine = 0;
  let newLine = 0;
  for (const [at, index] of [...uniqueAnchors(left, right), [left.length, right.length]]) {
    mapGap(left.slice(oldLine, at), right.slice(newLine, index), oldLine, newLine, map);
    if (index < right.length) map[index] = at;
    oldLine = at + 1;
    newLine = index + 1;
  }
  return map;
}

const relative = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function relativeTime(time: number, now = Date.now()): string {
  const seconds = (time - now) / 1000;
  for (const [unit, size] of UNITS)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "gerade eben";
}

export function blameLabel(commit: BlameCommit | null, now = Date.now()): string {
  if (!commit) return "Weicht vom Repository ab";
  if (commit.hash === UNCOMMITTED) return "Noch nicht committet";
  return `${commit.summary}, ${commit.author} (${relativeTime(commit.time, now)})`;
}

const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, "\\$&");

export function blameHover(commit: BlameCommit | null, path: string, now = Date.now()): string {
  if (!commit) return `Diese Zeile steht so nicht in \`${path}\`.`;
  if (commit.hash === UNCOMMITTED) return `Lokale Änderung in \`${path}\`, noch nicht committet.`;
  const date = new Date(commit.time).toLocaleString("de-DE", {
    dateStyle: "long",
    timeStyle: "short",
  });
  return [
    `**${escapeMarkdown(commit.author)}**${commit.mail ? ` ${escapeMarkdown(`<${commit.mail}>`)}` : ""}, ${relativeTime(commit.time, now)} (${date})`,
    escapeMarkdown(commit.summary),
    `\`${commit.hash.slice(0, 8)}\``,
  ].join("\n\n");
}

const TTL = 30_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

export function clearBlameCache() {
  cache.clear();
}

export async function loadBlame(
  target: BlameTarget,
  repo = localStorage.getItem("l8db.versioning.repo") ?? "",
): Promise<FileBlame | null> {
  if (!repo) return null;
  const project = await cached<VersioningProject | null>(`project\0${repo}`, async () => {
    const text = await readFile(repo, PROJECT_PATH);
    return text ? parseProject(text) : null;
  });
  if (!project || project.kind !== target.kind) return null;
  const object = project.objects.find(
    (entry) =>
      entry.selection.schema === target.schema &&
      entry.selection.objectName === target.name &&
      target.types.includes(entry.selection.objectType),
  );
  const path = target.part === "body" ? object?.bodyPath : object?.path;
  if (!path) return null;
  return cached(`blame\0${repo}\0${path}`, async () => {
    const porcelain = await versioningRepository<string | null>({ action: "blame", repo, path });
    return porcelain === null ? null : { repo, path, ...parseBlame(porcelain) };
  });
}
