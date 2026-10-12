export interface RoutineSignature {
  kind: string;
  name: string;
  params: string[];
  returns: string | null;
}

export interface CallContext {
  path: string[];
  activeArg: number;
  namedArg: string | null;
}

const MAX_SCAN = 20_000;

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function callAt(textBeforeCursor: string): CallContext | null {
  const text = textBeforeCursor.slice(-MAX_SCAN);
  const stack: { open: number; commas: number; argStart: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) return null;
      i = end;
    } else if (ch === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      if (end < 0) return null;
      i = end;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 1;
    } else if (ch === "(") stack.push({ open: i, commas: 0, argStart: i + 1 });
    else if (ch === ")") stack.pop();
    else if (ch === "," && stack.length) {
      const top = stack[stack.length - 1];
      top.commas++;
      top.argStart = i + 1;
    } else if (ch === ";") stack.length = 0;
  }
  const call = stack.at(-1);
  if (!call) return null;
  const name = /((?:"?[\w$#]+"?\s*\.\s*){0,2}"?[\w$#]+"?)\s*$/.exec(text.slice(0, call.open));
  if (!name) return null;
  const path = name[1].split(".").map((part) => part.trim().replace(/"/g, ""));
  const named = /^\s*"?([\w$#]+)"?\s*=>/.exec(text.slice(call.argStart));
  return { path, activeArg: call.commas, namedArg: named ? named[1] : null };
}

export function signaturesFromArgs(
  name: string,
  args: string,
  returns: string | null,
): RoutineSignature {
  return { kind: returns ? "FUNCTION" : "PROCEDURE", name, params: splitTopLevel(args), returns };
}

const ROUTINE =
  /\b(PROCEDURE|FUNCTION)\s+(?:"?[\w$#]+"?\s*\.\s*)?"?([\w$#]+)"?\s*(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?(?:\s*RETURNS?\s+("?[\w$#.%]+"?(?:\s*\([^()]*\))?))?/gi;

export function parseRoutineSignatures(source: string): RoutineSignature[] {
  const code = source.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, " ");
  return [...code.matchAll(ROUTINE)].map((match) => ({
    kind: match[1].toUpperCase(),
    name: match[2],
    params: match[3] ? splitTopLevel(match[3].slice(1, -1)) : [],
    returns: match[4] ?? null,
  }));
}

function paramName(param: string): string {
  return (/^"?([\w$#@]+)"?/.exec(param)?.[1] ?? "").toLowerCase();
}

export function signatureHelp(signatures: RoutineSignature[], call: CallContext, label: string) {
  if (!signatures.length) return null;
  const named = call.namedArg?.toLowerCase() ?? null;
  const activeIn = (sig: RoutineSignature) =>
    named ? sig.params.findIndex((param) => paramName(param) === named) : call.activeArg;
  const fits = signatures.findIndex((sig) => {
    const index = activeIn(sig);
    return index >= 0 && index < sig.params.length;
  });
  const activeSignature = Math.max(0, fits);
  return {
    activeSignature,
    activeParameter: Math.max(0, activeIn(signatures[activeSignature])),
    signatures: signatures.map((sig) => {
      const head = `${label}(`;
      let offset = head.length;
      const parameters = sig.params.map((param) => {
        const range: [number, number] = [offset, offset + param.length];
        offset += param.length + 2;
        return { label: range };
      });
      return {
        label: `${head}${sig.params.join(", ")})${sig.returns ? ` RETURN ${sig.returns}` : ""}`,
        documentation: sig.kind,
        parameters,
      };
    }),
  };
}
