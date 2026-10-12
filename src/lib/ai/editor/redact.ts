const MASK = "***";

function isUrlStop(code: number): boolean {
  return (
    code <= 32 ||
    code === 47 ||
    code === 63 ||
    code === 35 ||
    code === 39 ||
    code === 34 ||
    code === 60 ||
    code === 62 ||
    code === 96
  );
}

function redactUrlCredentials(text: string): string {
  if (!text.includes("://")) return text;
  let out = "";
  let last = 0;
  let index = text.indexOf("://");
  while (index >= 0) {
    const start = index + 3;
    let end = start;
    while (end < text.length && !isUrlStop(text.charCodeAt(end))) end++;
    const authority = text.slice(start, end);
    const at = authority.lastIndexOf("@");
    const colon = at > 0 ? authority.indexOf(":") : -1;
    if (colon >= 0 && colon < at - 1) {
      out += `${text.slice(last, start + colon + 1)}${MASK}`;
      last = start + at;
    }
    index = text.indexOf("://", Math.max(end, start));
  }
  return last === 0 ? text : out + text.slice(last);
}

const KEY_TOKEN =
  /^(?:x-)?(?:password|passwd|pwd|secret|client[_-]?secret|secret[_-]?key|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|api[_-]?key|apikey)$/;

const TRIGGERS =
  /password|passwd|pwd|secret|token|apikey|api[_-]key|private key|authorization|bearer|identified|sk-|akia|asia|gh[pousr]_|github_pat_|xox[abprs]-|aiza|glpat-|eyj/g;

const NAMED_TRIGGERS = new Set(["private key", "authorization", "bearer", "identified"]);

const KEY_TRIGGER = /^(?:password|passwd|pwd|secret|token|apikey|api[_-]key)$/;

interface TriggerScan {
  keys: number[];
  found: Set<string>;
}

function scanTriggers(lower: string): TriggerScan {
  const keys: number[] = [];
  const found = new Set<string>();
  TRIGGERS.lastIndex = 0;
  let match = TRIGGERS.exec(lower);
  while (match) {
    const word = match[0];
    if (KEY_TRIGGER.test(word)) {
      keys.push(match.index);
      if (word === "password") found.add(word);
    } else found.add(NAMED_TRIGGERS.has(word) ? word : "shape");
    match = TRIGGERS.exec(lower);
  }
  return { keys, found };
}

const QUOTED_VALUE = /["']?\s*(?::=|=|:)\s*("(?:[^"\\\n]|\\.){0,1000}"|'(?:[^'\n]|''){0,1000}')/y;

const PLAIN_VALUE = /=([^\s;,&"'}\]$:?@][^\s;,&"'}\]]{0,500})/y;

const COLON_VALUE = /[ \t]*:[ \t]+([^\s"'][^\r\n]{0,500})/y;

function isKeyChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 45
  );
}

function atLineStart(text: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const ch = text.charCodeAt(cursor);
    if (ch === 10 || ch === 13) return true;
    if (ch !== 32 && ch !== 9) return false;
  }
  return true;
}

function redactKeyValues(text: string, lower: string, positions: number[]): string {
  const edits: { start: number; end: number; value: string }[] = [];
  let scannedTo = 0;
  for (const found of positions) {
    if (found < scannedTo) continue;
    let start = found;
    while (start > 0 && isKeyChar(lower.charCodeAt(start - 1))) start--;
    let end = found;
    while (end < lower.length && isKeyChar(lower.charCodeAt(end))) end++;
    scannedTo = end;
    if (!KEY_TOKEN.test(lower.slice(start, end))) continue;
    QUOTED_VALUE.lastIndex = end;
    const quoted = QUOTED_VALUE.exec(text);
    if (quoted) {
      const value = quoted[1];
      const valueStart = QUOTED_VALUE.lastIndex - value.length;
      edits.push({ start: valueStart, end: QUOTED_VALUE.lastIndex, value: maskQuoted(value) });
      continue;
    }
    PLAIN_VALUE.lastIndex = end;
    const plain = PLAIN_VALUE.exec(text);
    if (plain) {
      edits.push({ start: end + 1, end: PLAIN_VALUE.lastIndex, value: MASK });
      continue;
    }
    if (!atLineStart(text, start)) continue;
    COLON_VALUE.lastIndex = end;
    const colon = COLON_VALUE.exec(text);
    if (colon) {
      edits.push({
        start: COLON_VALUE.lastIndex - colon[1].length,
        end: COLON_VALUE.lastIndex,
        value: MASK,
      });
    }
  }
  if (edits.length === 0) return text;
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let last = 0;
  for (const edit of edits) {
    if (edit.start < last) continue;
    out += text.slice(last, edit.start) + edit.value;
    last = edit.end;
  }
  return out + text.slice(last);
}

const IDENTIFIED_BY =
  /(\bIDENTIFIED\s+(?:WITH\s+[\w$]+\s+)?BY\s+(?:PASSWORD\s+)?)('(?:[^'\n]|''){0,1000}'|"[^"\n]{0,1000}"|[^\s;'"]{1,500})/gi;

const PASSWORD_LITERAL = /(\bPASSWORD\s+)('(?:[^'\n]|''){0,1000}'|"[^"\n]{0,1000}")/gi;

const AUTH_HEADER =
  /(\bAuthorization["']?\s*[:=]\s*["']?(?:Bearer|Basic|Token|Digest)\s+)([A-Za-z0-9._~+/=-]{1,4000})/gi;

const BEARER = /(\bBearer\s+)([A-Za-z0-9._~+/-]{12,4000}=*)/g;

const KEY_SHAPES: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

const PRIVATE_KEY =
  /-----BEGIN ([A-Z ]{0,40})PRIVATE KEY-----[\s\S]{0,20000}?-----END \1PRIVATE KEY-----/g;

function maskQuoted(value: string): string {
  const quote = value[0];
  return quote === "'" || quote === '"' ? `${quote}${MASK}${quote}` : MASK;
}

export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = redactUrlCredentials(text);
  const lower = out.toLowerCase();
  const { keys, found } = scanTriggers(lower);
  if (found.size === 0 && keys.length === 0) return out;
  if (keys.length) out = redactKeyValues(out, lower, keys);
  if (found.has("private key"))
    out = out.replace(
      PRIVATE_KEY,
      (_match, kind: string) =>
        `-----BEGIN ${kind}PRIVATE KEY-----${MASK}-----END ${kind}PRIVATE KEY-----`,
    );
  if (found.has("authorization"))
    out = out.replace(AUTH_HEADER, (_match, head: string) => `${head}${MASK}`);
  if (found.has("bearer")) out = out.replace(BEARER, (_match, head: string) => `${head}${MASK}`);
  if (found.has("identified"))
    out = out.replace(
      IDENTIFIED_BY,
      (_match, head: string, value: string) => `${head}${maskQuoted(value)}`,
    );
  if (found.has("password"))
    out = out.replace(
      PASSWORD_LITERAL,
      (_match, head: string, value: string) => `${head}${maskQuoted(value)}`,
    );
  if (found.has("shape")) for (const pattern of KEY_SHAPES) out = out.replace(pattern, MASK);
  return out;
}
