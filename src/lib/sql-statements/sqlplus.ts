export interface SubstitutionState {
  defines: Record<string, string>;
  marker: string | null;
  escape: string | null;
}

export interface SubstitutionResult {
  text: string;
  missing: string[];
}

export function createSubstitutionState(): SubstitutionState {
  return { defines: {}, marker: "&", escape: null };
}

const NAME_CHAR = /[A-Za-z0-9_$#]/;
const Q_CLOSE: Record<string, string> = { "[": "]", "{": "}", "(": ")", "<": ">" };

export function substitute(
  text: string,
  state: SubstitutionState,
  values: Record<string, string> = {},
): SubstitutionResult {
  const { marker, escape: escapeChar } = state;
  const missing: string[] = [];
  if (!marker || !text.includes(marker)) return { text, missing };
  let out = "";
  let index = 0;
  let close: string | null = null;
  const length = text.length;
  while (index < length) {
    const ch = text[index];
    if (close === null) {
      if (ch === "-" && text[index + 1] === "-") {
        const newline = text.indexOf("\n", index);
        const end = newline < 0 ? length : newline;
        out += text.slice(index, end);
        index = end;
        continue;
      }
      if (ch === "/" && text[index + 1] === "*") {
        const found = text.indexOf("*/", index + 2);
        const end = found < 0 ? length : found + 2;
        out += text.slice(index, end);
        index = end;
        continue;
      }
      const quote = /[nN]/.test(ch) && /[qQ]/.test(text[index + 1] ?? "") ? index + 1 : index;
      if (
        /[qQ]/.test(text[quote]) &&
        text[quote + 1] === "'" &&
        text[quote + 2] &&
        !/\s/.test(text[quote + 2]) &&
        !NAME_CHAR.test(text[index - 1] ?? "")
      ) {
        close = `${Q_CLOSE[text[quote + 2]] ?? text[quote + 2]}'`;
        out += text.slice(index, quote + 3);
        index = quote + 3;
        continue;
      }
      if (ch === "'" || ch === '"') {
        close = ch;
        out += ch;
        index += 1;
        continue;
      }
    } else if (text.startsWith(close, index)) {
      out += close;
      index += close.length;
      close = null;
      continue;
    }
    if (escapeChar && ch === escapeChar && text[index + 1] === marker) {
      out += marker;
      index += 2;
      continue;
    }
    if (ch !== marker) {
      out += ch;
      index += 1;
      continue;
    }
    const permanent = text[index + 1] === marker;
    const nameStart = index + (permanent ? 2 : 1);
    let nameEnd = nameStart;
    while (nameEnd < length && NAME_CHAR.test(text[nameEnd])) nameEnd += 1;
    if (nameEnd === nameStart) {
      out += text.slice(index, nameStart);
      index = nameStart;
      continue;
    }
    const key = text.slice(nameStart, nameEnd).toUpperCase();
    const end = text[nameEnd] === "." ? nameEnd + 1 : nameEnd;
    const value = state.defines[key] ?? values[key];
    if (value === undefined) {
      if (!missing.includes(key)) missing.push(key);
      out += text.slice(index, end);
    } else {
      if (permanent) state.defines[key] = value;
      out += value;
    }
    index = end;
  }
  return { text: out, missing };
}

export type SqlPlusCommand =
  | { type: "define"; name: string; value: string }
  | { type: "undefine"; names: string[] }
  | { type: "set-define"; marker: string | null }
  | { type: "set-escape"; escape: string | null }
  | { type: "serveroutput"; enabled: boolean }
  | { type: "whenever"; exit: boolean }
  | { type: "exit" }
  | { type: "prompt" }
  | { type: "describe"; name: string }
  | { type: "remark" }
  | { type: "other" };

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function switchValue(raw: string | undefined, fallback: string): string | null {
  const value = unquote(raw ?? "");
  const upper = value.toUpperCase();
  if (upper === "OFF") return null;
  if (upper === "ON" || !value) return fallback;
  return value[0];
}

export function parseSqlPlusCommand(text: string): SqlPlusCommand {
  const words = text.trim().split(/\s+/);
  const first = words[0].toUpperCase();
  const second = (words[1] ?? "").toUpperCase();
  if (first === "REM" || first === "REMARK") return { type: "remark" };
  if (first === "DEF" || first === "DEFINE") {
    const match = /^\S+\s+([^=\s]+)\s*=\s*([\s\S]*)$/.exec(text.trim());
    return match
      ? { type: "define", name: match[1].toUpperCase(), value: unquote(match[2]) }
      : { type: "other" };
  }
  if (first === "UNDEF" || first === "UNDEFINE")
    return { type: "undefine", names: words.slice(1).map((name) => name.toUpperCase()) };
  if (first === "SET" && /^DEF(INE?)?$/.test(second))
    return { type: "set-define", marker: switchValue(words[2], "&") };
  if (first === "SET" && /^ESC(APE?)?$/.test(second))
    return { type: "set-escape", escape: switchValue(words[2], "\\") };
  if (first === "SET" && /^SERVEROUT(PUT)?$/.test(second) && /^(ON|OFF)$/i.test(words[2] ?? ""))
    return { type: "serveroutput", enabled: words[2].toUpperCase() === "ON" };
  const action = (words[2] ?? "").toUpperCase();
  if (first === "WHENEVER" && second === "SQLERROR" && /^(EXIT|CONTINUE)$/.test(action))
    return { type: "whenever", exit: action === "EXIT" };
  if (first === "EXIT" || first === "QUIT") return { type: "exit" };
  if (first === "PRO" || first === "PROMPT") return { type: "prompt" };
  if ((first === "DESC" || first === "DESCRIBE") && words[1])
    return {
      type: "describe",
      name: text.trim().slice(words[0].length).trim().replace(/;$/, ""),
    };
  return { type: "other" };
}

export type AskVariables = (
  names: string[],
  defaults: Record<string, string>,
) => Promise<Record<string, string> | null>;

export interface SubstitutionSession {
  state: SubstitutionState;
  answers: Record<string, string>;
}

const SESSION_LIMIT = 200;
const sessions = new Map<string, SubstitutionSession>();

export function substitutionSession(key: string): SubstitutionSession {
  let session = sessions.get(key);
  if (!session) {
    session = { state: createSubstitutionState(), answers: {} };
    sessions.set(key, session);
    if (sessions.size > SESSION_LIMIT) sessions.delete(sessions.keys().next().value as string);
  }
  return session;
}

export async function askMissingVariables(
  parts: { kind: string; text: string }[],
  session: SubstitutionSession,
  ask: AskVariables | undefined,
): Promise<Record<string, string> | null> {
  const simulated = { ...session.state, defines: { ...session.state.defines } };
  const missing: string[] = [];
  for (const part of parts) {
    if (part.kind === "command") applySqlPlusSetting(parseSqlPlusCommand(part.text), simulated);
    else if (part.kind === "sql")
      for (const name of substitute(part.text, simulated).missing)
        if (!missing.includes(name)) missing.push(name);
  }
  if (!missing.length) return {};
  if (!ask)
    throw new Error(
      `Substitutionsvariable &${missing[0]} ist nicht definiert (DEFINE ${missing[0]} = … oder SET DEFINE OFF).`,
    );
  const answers = await ask(missing, session.answers);
  if (answers) Object.assign(session.answers, answers);
  return answers;
}

export function oracleObjectName(name: string): { schema: string | null; object: string } | null {
  const parts = name.match(/"(?:[^"]|"")*"|[^."]+/g) ?? [];
  if (!parts.length || parts.length > 2 || name.includes("@")) return null;
  const plain = parts.map((part) =>
    part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toUpperCase(),
  );
  return plain.length === 2
    ? { schema: plain[0], object: plain[1] }
    : { schema: null, object: plain[0] };
}

export function applySqlPlusSetting(command: SqlPlusCommand, state: SubstitutionState): boolean {
  if (command.type === "define") state.defines[command.name] = command.value;
  else if (command.type === "undefine")
    for (const name of command.names) delete state.defines[name];
  else if (command.type === "set-define") state.marker = command.marker;
  else if (command.type === "set-escape") state.escape = command.escape;
  else return false;
  return true;
}
