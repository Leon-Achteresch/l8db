export type PackagePart = "spec" | "body";

export function packageOid(schema: string, name: string, part: PackagePart): string {
  return [schema, name, part === "spec" ? "PACKAGE" : "PACKAGE BODY"].join("");
}

export type PlsqlMember = { kind: "FUNCTION" | "PROCEDURE"; name: string; line: number };

export function parsePlsqlMembers(source: string): PlsqlMember[] {
  const members: PlsqlMember[] = [];
  const seen = new Set<string>();
  source.split("\n").forEach((text, i) => {
    const m = /^\s*(FUNCTION|PROCEDURE)\s+"?([\w$#]+)"?/i.exec(text);
    if (!m) return;
    const kind = m[1].toUpperCase() as PlsqlMember["kind"];
    const name = m[2].toUpperCase();
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    members.push({ kind, name, line: i + 1 });
  });
  return members;
}
