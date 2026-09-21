export function sqlCode(sql: string): string {
  let result = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = rest.indexOf("\n");
      i += end < 0 ? rest.length : end;
      result += " ";
    } else if (rest.startsWith("/*")) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.slice(i, i + 2) === "/*") {
          depth++;
          i += 2;
        } else if (sql.slice(i, i + 2) === "*/") {
          depth--;
          i += 2;
        } else i++;
      }
      result += " ";
    } else if (/^q'/i.test(rest) && rest.length > 3) {
      const close =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[rest[2]] ?? rest[2];
      const end = rest.indexOf(`${close}'`, 3);
      i += end < 0 ? rest.length : end + 2;
      result += " '' ";
    } else if (rest[0] === "'") {
      const escaped = i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/[\w$]/.test(sql[i - 2]));
      i++;
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i++] === "'") break;
      }
      result += " '' ";
    } else if (rest[0] === '"') {
      const quoted = /^"(?:[^"]|"")*"/.exec(rest)?.[0] ?? rest;
      result += quoted;
      i += quoted.length;
    } else {
      const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)?.[0];
      if (dollar) {
        const end = rest.indexOf(dollar, dollar.length);
        i += end < 0 ? rest.length : end + dollar.length;
        result += " $$ $$ ";
      } else result += sql[i++];
    }
  }
  return result.trim();
}
