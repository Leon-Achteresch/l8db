export interface SubstitutionState {
  defines: Record<string, string>;
  marker: string | null;
  escape: string | null;
  concat?: string | null;
}

export interface SubstitutionResult {
  text: string;
  missing: string[];
}

export function createSubstitutionState(): SubstitutionState {
  return { defines: {}, marker: "&", escape: null, concat: "." };
}

const NAME_CHAR = /[A-Za-z0-9_$#]/;
const Q_CLOSE: Record<string, string> = { "[": "]", "{": "}", "(": ")", "<": ">" };

function quoteEnd(text: string, index: number): { open: number; close: string } | null {
  const ch = text[index];
  const quote = /[nN]/.test(ch) && /[qQ]/.test(text[index + 1] ?? "") ? index + 1 : index;
  if (
    /[qQ]/.test(text[quote]) &&
    text[quote + 1] === "'" &&
    text[quote + 2] &&
    !/\s/.test(text[quote + 2]) &&
    !NAME_CHAR.test(text[index - 1] ?? "")
  )
    return { open: quote + 3, close: `${Q_CLOSE[text[quote + 2]] ?? text[quote + 2]}'` };
  if (ch === "'" || ch === '"') return { open: index + 1, close: ch };
  return null;
}

function commentEnd(text: string, index: number): number {
  if (text[index] === "-" && text[index + 1] === "-") {
    const newline = text.indexOf("\n", index);
    return newline < 0 ? text.length : newline;
  }
  if (text[index] === "/" && text[index + 1] === "*") {
    const found = text.indexOf("*/", index + 2);
    return found < 0 ? text.length : found + 2;
  }
  return index;
}

export function substitute(
  text: string,
  state: SubstitutionState,
  values: Record<string, string> = {},
): SubstitutionResult {
  const { marker, escape: escapeChar } = state;
  const concat = state.concat === undefined ? "." : state.concat;
  const missing: string[] = [];
  if (!marker || !text.includes(marker)) return { text, missing };
  let out = "";
  let index = 0;
  let close: string | null = null;
  const length = text.length;
  while (index < length) {
    const ch = text[index];
    if (close === null) {
      const comment = commentEnd(text, index);
      if (comment > index) {
        out += text.slice(index, comment);
        index = comment;
        continue;
      }
      const quoted = quoteEnd(text, index);
      if (quoted) {
        close = quoted.close;
        out += text.slice(index, quoted.open);
        index = quoted.open;
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
    const end = concat && text[nameEnd] === concat ? nameEnd + 1 : nameEnd;
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

export function bindNames(text: string): string[] {
  const names: string[] = [];
  let index = 0;
  while (index < text.length) {
    const comment = commentEnd(text, index);
    if (comment > index) {
      index = comment;
      continue;
    }
    const quoted = quoteEnd(text, index);
    if (quoted) {
      const end = text.indexOf(quoted.close, quoted.open);
      index = end < 0 ? text.length : end + quoted.close.length;
      continue;
    }
    if (text[index] === ":" && /[A-Za-z]/.test(text[index + 1] ?? "")) {
      let end = index + 1;
      while (end < text.length && NAME_CHAR.test(text[end])) end += 1;
      const name = text.slice(index + 1, end).toUpperCase();
      if (!names.includes(name)) names.push(name);
      index = end;
      continue;
    }
    index += 1;
  }
  return names;
}

export type ExitStatus =
  | { kind: "code"; value: number; label: string }
  | { kind: "variable"; name: string }
  | { kind: "bind"; name: string };

export type ExitAction = "COMMIT" | "ROLLBACK";

export type SqlPlusCommand =
  | { type: "define"; name: string; value: string }
  | { type: "define-show"; name: string | null }
  | { type: "undefine"; names: string[] }
  | { type: "set-define"; marker: string | null }
  | { type: "set-escape"; escape: string | null }
  | { type: "set-concat"; concat: string | null }
  | { type: "set-verify"; enabled: boolean }
  | { type: "set-autoprint"; enabled: boolean }
  | { type: "serveroutput"; enabled: boolean }
  | { type: "set-autocommit"; every: number }
  | { type: "set-exitcommit"; enabled: boolean }
  | { type: "set-display"; option: string }
  | { type: "set-unsupported"; option: string }
  | {
      type: "whenever";
      event: "SQLERROR" | "OSERROR";
      exit: boolean;
      status: ExitStatus;
      action: ExitAction | "NONE" | null;
    }
  | { type: "exit"; status: ExitStatus; action: ExitAction | null }
  | { type: "prompt"; text: string }
  | { type: "describe"; name: string }
  | { type: "connect" }
  | { type: "host" }
  | { type: "unsupported"; name: string }
  | { type: "remark" }
  | { type: "show"; what: string; rest: string }
  | { type: "variable"; name: string | null; dataType: string | null; value: string | null }
  | { type: "print"; names: string[] }
  | { type: "spool"; file: string | null; mode: "CREATE" | "REPLACE" | "APPEND" }
  | {
      type: "accept";
      name: string;
      prompt: string | null;
      defaultValue: string | null;
      hide: boolean;
    }
  | { type: "pause"; text: string }
  | { type: "column"; name: string; newValue: string | null; oldValue: string | null }
  | { type: "timing"; action: "START" | "STOP" | "SHOW"; name: string | null }
  | { type: "display"; name: string }
  | { type: "invalid"; message: string }
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

function abbrev(word: string, full: string, min: number): boolean {
  return word.length >= min && full.startsWith(word);
}

function named(word: string, ...forms: [string, number][]): boolean {
  return forms.some(([full, min]) => abbrev(word, full, min));
}

const STATUS_CODES: Record<string, number> = { SUCCESS: 0, FAILURE: 1, WARNING: 2 };
const SUCCESS: ExitStatus = { kind: "code", value: 0, label: "SUCCESS" };

function exitClause(words: string[]): { status: ExitStatus; action: ExitAction | null } | null {
  let status = SUCCESS;
  let action: ExitAction | null = null;
  let rest = words;
  const first = rest[0]?.toUpperCase();
  if (first && first !== "COMMIT" && first !== "ROLLBACK") {
    if (first in STATUS_CODES) status = { kind: "code", value: STATUS_CODES[first], label: first };
    else if (/^-?\d+$/.test(first)) status = { kind: "code", value: Number(first), label: first };
    else if (/^:[A-Z][\w$#]*$/.test(first)) status = { kind: "bind", name: first.slice(1) };
    else if (/^[A-Z_][\w$#]*(\.[A-Z][\w$#]*)?$/.test(first))
      status = { kind: "variable", name: first };
    else return null;
    rest = rest.slice(1);
  }
  const next = rest[0]?.toUpperCase();
  if (next === "COMMIT" || next === "ROLLBACK") {
    action = next;
    rest = rest.slice(1);
  }
  return rest.length ? null : { status, action };
}

function setCommand(words: string[]): SqlPlusCommand {
  const option = (words[1] ?? "").toUpperCase();
  const value = (words[2] ?? "").toUpperCase();
  const onOff = value === "ON" ? true : value === "OFF" ? false : null;
  if (named(option, ["DEFINE", 3]))
    return { type: "set-define", marker: switchValue(words[2], "&") };
  if (option === "SCAN" && onOff !== null)
    return { type: "set-define", marker: onOff ? "&" : null };
  if (named(option, ["ESCAPE", 3]))
    return { type: "set-escape", escape: switchValue(words[2], "\\") };
  if (named(option, ["CONCAT", 3]))
    return { type: "set-concat", concat: switchValue(words[2], ".") };
  if (named(option, ["SERVEROUTPUT", 9]) && onOff !== null)
    return { type: "serveroutput", enabled: onOff };
  if (named(option, ["VERIFY", 3]) && onOff !== null) return { type: "set-verify", enabled: onOff };
  if (named(option, ["AUTOPRINT", 5]) && onOff !== null)
    return { type: "set-autoprint", enabled: onOff };
  if (named(option, ["EXITCOMMIT", 5]) && onOff !== null)
    return { type: "set-exitcommit", enabled: onOff };
  if (named(option, ["AUTOCOMMIT", 4])) {
    if (value === "ON" || value === "IMMEDIATE") return { type: "set-autocommit", every: 1 };
    if (value === "OFF") return { type: "set-autocommit", every: 0 };
    if (/^\d+$/.test(value)) return { type: "set-autocommit", every: Number(value) };
    return {
      type: "invalid",
      message: `SET AUTOCOMMIT erwartet ON, OFF, IMMEDIATE oder eine Zahl.`,
    };
  }
  if (named(option, ["SQLTERMINATOR", 4], ["BLOCKTERMINATOR", 3], ["CMDSEP", 4], ["SQLPREFIX", 6]))
    return { type: "set-unsupported", option };
  return { type: "set-display", option: option || "SET" };
}

const DISPLAY_COMMANDS: [string, number][] = [
  ["TTITLE", 3],
  ["BTITLE", 3],
  ["REPHEADER", 4],
  ["REPFOOTER", 4],
  ["BREAK", 3],
  ["COMPUTE", 4],
  ["CLEAR", 2],
  ["ATTRIBUTE", 4],
  ["STORE", 5],
  ["SAVE", 3],
  ["GET", 3],
  ["EDIT", 2],
  ["INPUT", 1],
  ["LIST", 1],
  ["APPEND", 1],
  ["CHANGE", 1],
  ["DEL", 3],
  ["RUN", 1],
  ["HELP", 4],
  ["HISTORY", 4],
];

const UNSUPPORTED_COMMANDS: [string, number][] = [
  ["STARTUP", 7],
  ["SHUTDOWN", 8],
  ["RECOVER", 7],
  ["ARCHIVE", 7],
  ["PASSWORD", 5],
  ["COPY", 4],
  ["XQUERY", 6],
];

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function acceptCommand(text: string): SqlPlusCommand {
  const match = /^\S+\s+([A-Za-z0-9_$#]+)([\s\S]*)$/.exec(text.trim());
  if (!match) return { type: "invalid", message: "ACCEPT erwartet einen Variablennamen." };
  const tokens = match[2].match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|\S+/g) ?? [];
  let prompt: string | null = null;
  let defaultValue: string | null = null;
  let hide = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index].toUpperCase();
    if (named(word, ["PROMPT", 3])) {
      prompt = unquote(tokens[index + 1] ?? "");
      index += 1;
    } else if (named(word, ["DEFAULT", 3])) {
      defaultValue = unquote(tokens[index + 1] ?? "");
      index += 1;
    } else if (named(word, ["FORMAT", 3])) index += 1;
    else if (word === "HIDE") hide = true;
  }
  return { type: "accept", name: match[1].toUpperCase(), prompt, defaultValue, hide };
}

function columnCommand(parts: string[]): SqlPlusCommand {
  const name = parts[1];
  if (!name) return { type: "display", name: "COLUMN" };
  let newValue: string | null = null;
  let oldValue: string | null = null;
  for (let index = 2; index < parts.length; index += 1) {
    const word = parts[index].toUpperCase();
    if (named(word, ["NEW_VALUE", 5])) newValue = (parts[index + 1] ?? "").toUpperCase() || null;
    if (named(word, ["OLD_VALUE", 5])) oldValue = (parts[index + 1] ?? "").toUpperCase() || null;
  }
  const column = name.startsWith('"') ? name.slice(1, -1) : name.toUpperCase();
  return newValue || oldValue
    ? { type: "column", name: column, newValue, oldValue }
    : { type: "display", name: "COLUMN" };
}

function variableCommand(text: string): SqlPlusCommand {
  const match =
    /^\S+(?:\s+([A-Za-z][\w$#]*))?(?:\s+([A-Za-z_][\w ]*?(?:\(\s*\d+\s*(?:\w+\s*)?\))?))?(?:\s*=\s*([\s\S]*))?$/.exec(
      text.trim(),
    );
  if (!match) return { type: "invalid", message: `Ungültige VARIABLE-Angabe: ${text.trim()}` };
  const value = match[3] === undefined ? null : unquote(match[3]);
  return {
    type: "variable",
    name: match[1]?.toUpperCase() ?? null,
    dataType: match[2]?.trim().toUpperCase().replace(/\s+/g, " ") ?? null,
    value,
  };
}

function spoolCommand(parts: string[], text: string): SqlPlusCommand {
  const target = parts[1];
  if (!target) return { type: "show", what: "SPOOL", rest: "" };
  const upper = target.toUpperCase();
  if (upper === "OFF" || upper === "OUT") return { type: "spool", file: null, mode: "REPLACE" };
  const last = (parts.at(-1) ?? "").toUpperCase();
  const mode = last === "CREATE" || last === "APPEND" || last === "REPLACE" ? last : "REPLACE";
  const raw = text
    .trim()
    .slice(parts[0].length)
    .trim()
    .replace(/\s+(CRE(ATE)?|REP(LACE)?|APP(END)?)$/i, "");
  return { type: "spool", file: unquote(raw), mode };
}

function stripSemicolon(text: string): string {
  return text.replace(/\s*;+\s*$/, "");
}

export function parseSqlPlusCommand(raw: string): SqlPlusCommand {
  const text = raw.replace(/[ \t]+-[ \t]*\r?\n[ \t]*/g, " ");
  const original = words(text);
  const first = (original[0] ?? "").toUpperCase();
  if (first === "REM" || first === "REMARK") return { type: "remark" };
  if (named(first, ["PROMPT", 3]))
    return {
      type: "prompt",
      text: text
        .trim()
        .slice(original[0].length)
        .replace(/^[ \t]/, ""),
    };
  if (named(first, ["PAUSE", 3]))
    return { type: "pause", text: text.trim().slice(original[0].length).trim() };
  if (named(first, ["ACCEPT", 3])) return acceptCommand(stripSemicolon(text));
  if (named(first, ["DEFINE", 3])) {
    const match = /^\S+\s+([^=\s]+)\s*=\s*([\s\S]*)$/.exec(text.trim());
    if (match) return { type: "define", name: match[1].toUpperCase(), value: unquote(match[2]) };
    const name = stripSemicolon(text.trim()).split(/\s+/)[1];
    return { type: "define-show", name: name ? name.toUpperCase() : null };
  }
  const plain = words(stripSemicolon(text));
  const second = (plain[1] ?? "").toUpperCase();
  if (named(first, ["UNDEFINE", 5]))
    return { type: "undefine", names: plain.slice(1).map((name) => name.toUpperCase()) };
  if (first === "SET") return setCommand(plain);
  if (first === "WHENEVER") {
    if (second !== "SQLERROR" && second !== "OSERROR")
      return { type: "invalid", message: "WHENEVER erwartet SQLERROR oder OSERROR." };
    const action = (plain[2] ?? "").toUpperCase();
    if (action === "CONTINUE") {
      const then = (plain[3] ?? "NONE").toUpperCase();
      if (!["COMMIT", "ROLLBACK", "NONE"].includes(then) || plain.length > 4)
        return {
          type: "invalid",
          message: "WHENEVER … CONTINUE erwartet COMMIT, ROLLBACK oder NONE.",
        };
      return {
        type: "whenever",
        event: second,
        exit: false,
        status: SUCCESS,
        action: then as ExitAction | "NONE",
      };
    }
    const clause = action === "EXIT" ? exitClause(plain.slice(3)) : null;
    if (!clause)
      return { type: "invalid", message: `Ungültige WHENEVER-Angabe: ${plain.join(" ")}` };
    return { type: "whenever", event: second, exit: true, ...clause };
  }
  if (first === "EXIT" || first === "QUIT") {
    const clause = exitClause(plain.slice(1));
    return clause
      ? { type: "exit", ...clause }
      : { type: "invalid", message: `Ungültige EXIT-Angabe: ${plain.join(" ")}` };
  }
  if (named(first, ["CONNECT", 4], ["DISCONNECT", 4])) return { type: "connect" };
  if (named(first, ["HOST", 2])) return { type: "host" };
  if (named(first, ["DESCRIBE", 4]) && plain[1])
    return {
      type: "describe",
      name: stripSemicolon(text.trim()).slice(original[0].length).trim(),
    };
  if (named(first, ["SHOW", 3]))
    return { type: "show", what: second, rest: plain.slice(2).join(" ") };
  if (named(first, ["VARIABLE", 3])) return variableCommand(stripSemicolon(text));
  if (named(first, ["PRINT", 3]))
    return {
      type: "print",
      names: plain.slice(1).map((name) => name.replace(/^:/, "").toUpperCase()),
    };
  if (named(first, ["SPOOL", 3])) return spoolCommand(plain, stripSemicolon(text));
  if (named(first, ["COLUMN", 3])) return columnCommand(plain);
  if (named(first, ["TIMING", 4])) {
    const action = second || "SHOW";
    if (!["START", "STOP", "SHOW"].includes(action))
      return { type: "invalid", message: "TIMING erwartet START, STOP oder SHOW." };
    return {
      type: "timing",
      action: action as "START" | "STOP" | "SHOW",
      name: plain[2]?.toUpperCase() ?? null,
    };
  }
  const unsupported = UNSUPPORTED_COMMANDS.find(([full, min]) => abbrev(first, full, min));
  if (unsupported) return { type: "unsupported", name: unsupported[0] };
  const display = DISPLAY_COMMANDS.find(([full, min]) => abbrev(first, full, min));
  if (display) return { type: "display", name: display[0] };
  return { type: "other" };
}

export const SUBSTITUTED_COMMANDS = new Set([
  "define",
  "prompt",
  "pause",
  "spool",
  "accept",
  "exit",
  "whenever",
  "timing",
  "show",
  "print",
  "variable",
  "describe",
  "column",
]);

export function substitutesCommand(text: string): boolean {
  return SUBSTITUTED_COMMANDS.has(parseSqlPlusCommand(text).type);
}

export interface VariablePrompt {
  label: string | null;
  hide: boolean;
}

export type AskVariables = (
  names: string[],
  defaults: Record<string, string>,
  prompts?: Record<string, VariablePrompt>,
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

export const PREDEFINED_VARIABLES = [
  "_USER",
  "_CONNECT_IDENTIFIER",
  "_DATE",
  "_PRIVILEGE",
  "_SQLPLUS_RELEASE",
  "_EDITOR",
  "_O_VERSION",
  "_O_RELEASE",
];

export async function askMissingVariables(
  parts: { kind: string; text: string; defines?: Record<string, string> }[],
  session: SubstitutionSession,
  ask: AskVariables | undefined,
): Promise<Record<string, string> | null> {
  const simulated = { ...session.state, defines: { ...session.state.defines } };
  for (const name of PREDEFINED_VARIABLES) simulated.defines[name] ??= "";
  const missing: string[] = [];
  const prompts: Record<string, VariablePrompt> = {};
  const defaults: Record<string, string> = { ...session.answers };
  const need = (name: string) => {
    if (!missing.includes(name)) missing.push(name);
  };
  for (const part of parts) {
    Object.assign(simulated.defines, part.defines);
    if (part.kind === "command") {
      const command = parseSqlPlusCommand(part.text);
      if (SUBSTITUTED_COMMANDS.has(command.type))
        for (const name of substitute(part.text, simulated).missing) need(name);
      if (command.type === "accept") {
        need(command.name);
        prompts[command.name] = { label: command.prompt, hide: command.hide };
        if (command.hide) delete defaults[command.name];
        if (command.defaultValue !== null && !(command.name in defaults))
          defaults[command.name] = command.defaultValue;
        simulated.defines[command.name] = "";
      } else if (command.type === "column") {
        if (command.newValue) simulated.defines[command.newValue] ??= "";
        if (command.oldValue) simulated.defines[command.oldValue] ??= "";
      } else applySqlPlusSetting(command, simulated);
    } else if (part.kind === "sql")
      for (const name of substitute(part.text, simulated).missing) need(name);
  }
  if (!missing.length) return {};
  if (!ask && missing.every((name) => prompts[name]))
    return Object.fromEntries(missing.map((name) => [name, defaults[name] ?? ""]));
  if (!ask)
    throw new Error(
      `Substitutionsvariable &${missing[0]} ist nicht definiert (DEFINE ${missing[0]} = … oder SET DEFINE OFF).`,
    );
  const answers = await ask(missing, defaults, Object.keys(prompts).length ? prompts : undefined);
  if (answers)
    for (const [name, value] of Object.entries(answers))
      if (!prompts[name]?.hide) session.answers[name] = value;
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
  else if (command.type === "set-concat") state.concat = command.concat;
  else return false;
  return true;
}
