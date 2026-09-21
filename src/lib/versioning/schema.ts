export function requalify(sql: string, from: string, to: string): string {
  if (!from || !to) throw new Error("Schema-Zuordnung ist unvollständig.");
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    let opaque: string | undefined;
    if (rest.startsWith("--"))
      opaque = rest.slice(0, rest.indexOf("\n") < 0 ? rest.length : rest.indexOf("\n"));
    else if (rest.startsWith("/*")) {
      let end = 2;
      let depth = 1;
      while (end < rest.length && depth) {
        if (rest.slice(end, end + 2) === "/*") {
          depth += 1;
          end += 2;
        } else if (rest.slice(end, end + 2) === "*/") {
          depth -= 1;
          end += 2;
        } else end += 1;
      }
      opaque = rest.slice(0, end);
    } else if (/^q'/i.test(rest) && rest.length > 3) {
      const close =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[rest[2]] ?? rest[2];
      const end = rest.indexOf(`${close}'`, 3);
      opaque = end < 0 ? rest : rest.slice(0, end + 2);
    } else if (rest.startsWith("'")) {
      let end = 1;
      while (end < rest.length) {
        if (rest[end] === "'") {
          if (rest[end + 1] === "'") end += 2;
          else {
            end += 1;
            break;
          }
        } else if (rest[end] === "\\") end += 2;
        else end += 1;
      }
      opaque = rest.slice(0, end);
    } else {
      const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)?.[0];
      if (dollar) {
        const end = rest.indexOf(dollar, dollar.length);
        opaque = end < 0 ? rest : rest.slice(0, end + dollar.length);
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (
          from !== to &&
          new RegExp(`(?:"${escaped.replaceAll('"', '""')}"|\\b${escaped})\\s*\\.`, "i").test(
            opaque,
          )
        )
          throw new Error(
            "Schema-Zuordnung im Dollar-String erfordert eine ausdrücklich angepasste Migration.",
          );
      }
    }
    if (opaque !== undefined) {
      output += opaque;
      index += opaque.length;
      continue;
    }
    const token = /^(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$#]*)/.exec(rest)?.[0];
    if (token) {
      const name = token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token;
      const matches = token.startsWith('"')
        ? name === from
        : name.toLowerCase() === from.toLowerCase();
      output +=
        matches && /^\s*\./.test(rest.slice(token.length))
          ? `"${to.replaceAll('"', '""')}"`
          : token;
      index += token.length;
    } else {
      output += sql[index];
      index += 1;
    }
  }
  return output;
}
