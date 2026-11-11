export type PatchLineKind = "hunk" | "add" | "del" | "ctx" | "note";

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
  old?: number;
  new?: number;
}

export type PatchStatus = "added" | "deleted" | "renamed" | "modified";

export interface PatchFile {
  path: string;
  from?: string;
  status: PatchStatus;
  binary: boolean;
  added: number;
  removed: number;
  lines: PatchLine[];
}

export interface CommitDetails {
  id: string;
  author: string;
  date: string;
  message: string;
  patch: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseCommitPatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const header = raw.slice(11).match(/^a\/(.*) b\/(.*)$/);
      file = {
        path: header?.[2] ?? raw.slice(11),
        status: "modified",
        binary: false,
        added: 0,
        removed: 0,
        lines: [],
      };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    const hunk = raw.match(HUNK);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith("new file mode")) file.status = "added";
      else if (raw.startsWith("deleted file mode")) file.status = "deleted";
      else if (raw.startsWith("rename from ")) {
        file.status = "renamed";
        file.from = raw.slice(12);
      } else if (raw.startsWith("rename to ")) file.path = raw.slice(10);
      else if (raw.startsWith("+++ b/")) file.path = raw.slice(6);
      else if (raw.startsWith("--- a/") && file.status === "deleted") file.path = raw.slice(6);
      else if (raw.startsWith("Binary files ")) file.binary = true;
      continue;
    }
    if (raw.startsWith("+")) {
      file.added++;
      file.lines.push({ kind: "add", text: raw.slice(1), new: newLine++ });
    } else if (raw.startsWith("-")) {
      file.removed++;
      file.lines.push({ kind: "del", text: raw.slice(1), old: oldLine++ });
    } else if (raw.startsWith(" ")) {
      file.lines.push({ kind: "ctx", text: raw.slice(1), old: oldLine++, new: newLine++ });
    } else if (raw.startsWith("\\")) {
      file.lines.push({ kind: "note", text: raw.slice(2) });
    }
  }
  return files;
}
