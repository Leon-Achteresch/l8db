export type PackagePart = "spec" | "body";

export function packageOid(schema: string, name: string, part: PackagePart): string {
  return [schema, name, part === "spec" ? "PACKAGE" : "PACKAGE BODY"].join("");
}

export type PlsqlMember = { kind: "FUNCTION" | "PROCEDURE"; name: string; line: number };

function isBodyAt(lines: string[], index: number, offset: number): boolean {
  let text = lines[index].slice(offset);
  for (let j = index; j < lines.length; j++) {
    if (j > index) text += `\n${lines[j]}`;
    const semi = text.indexOf(";");
    if (/\b(is|as)\b/i.test(semi >= 0 ? text.slice(0, semi) : text)) return true;
    if (semi >= 0) return false;
  }
  return false;
}

export function parsePlsqlMembers(source: string): PlsqlMember[] {
  const groups = new Map<string, { decls: PlsqlMember[]; bodies: PlsqlMember[] }>();
  const lines = source.split("\n");
  lines.forEach((text, i) => {
    const m = /^\s*(FUNCTION|PROCEDURE)\s+"?([\w$#]+)"?/i.exec(text);
    if (!m) return;
    const kind = m[1].toUpperCase() as PlsqlMember["kind"];
    const name = m[2].toUpperCase();
    const key = `${kind}:${name}`;
    const group = groups.get(key) ?? { decls: [], bodies: [] };
    groups.set(key, group);
    (isBodyAt(lines, i, m[0].length) ? group.bodies : group.decls).push({
      kind,
      name,
      line: i + 1,
    });
  });
  return [...groups.values()].flatMap((g) => (g.bodies.length ? g.bodies : g.decls));
}
