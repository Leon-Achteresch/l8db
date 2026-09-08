export type PackagePart = "spec" | "body";

export function packageOid(schema: string, name: string, part: PackagePart): string {
  return [schema, name, part === "spec" ? "PACKAGE" : "PACKAGE BODY"].join("");
}

export type PlsqlMember = { kind: "FUNCTION" | "PROCEDURE"; name: string; line: number };

export function parsePlsqlMembers(source: string): PlsqlMember[] {
  const members: PlsqlMember[] = [];
  const indexByKey = new Map<string, number>();
  source.split("\n").forEach((text, i) => {
    const m = /^\s*(FUNCTION|PROCEDURE)\s+"?([\w$#]+)"?/i.exec(text);
    if (!m) return;
    const kind = m[1].toUpperCase() as PlsqlMember["kind"];
    const name = m[2].toUpperCase();
    const key = `${kind}:${name}`;
    const member: PlsqlMember = { kind, name, line: i + 1 };
    const existing = indexByKey.get(key);
    const isBody = /\b(is|as)\b/i.test(text.slice(m[0].length));
    if (existing === undefined) {
      indexByKey.set(key, members.length);
      members.push(member);
      return;
    }
    if (isBody) members[existing] = member;
  });
  return members;
}
