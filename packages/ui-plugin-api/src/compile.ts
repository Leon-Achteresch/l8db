import { type Transform, transform } from "sucrase";
import { ScanError, type Token, tokenize } from "./scan";

export const ALLOWED_IMPORTS = ["react", "react/jsx-runtime", "@l8db/ui"] as const;

export const MAX_SOURCE_LENGTH = 256 * 1024;

export const PLUGIN_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(tsx|ts|jsx|js)$/;

const BLOCKED_GLOBALS = new Set([
  "window",
  "document",
  "globalThis",
  "frames",
  "opener",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "cookieStore",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "ServiceWorker",
  "BroadcastChannel",
  "importScripts",
  "eval",
  "Function",
  "require",
  "process",
  "module",
  "exports",
]);

const BLOCKED_PROPERTIES = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "insertAdjacentElement",
  "dangerouslySetInnerHTML",
  "createPortal",
  "createElement",
  "ownerDocument",
  "defaultView",
  "parentNode",
  "parentElement",
  "getRootNode",
  "offsetParent",
  "closest",
  "contentWindow",
  "contentDocument",
  "srcdoc",
]);

const BLOCKED_ELEMENTS =
  /\b_jsxs?\d*\(\s*(["'])(script|style|iframe|frame|frameset|object|embed|link|meta|base|portal|template)\1/i;

export type CompileError = { message: string; line?: number; column?: number };

export type CompileResult = { ok: true; code: string } | { ok: false; error: CompileError };

function sourceTransforms(fileName: string): Transform[] {
  if (fileName.endsWith(".tsx")) return ["typescript", "jsx"];
  if (fileName.endsWith(".ts")) return ["typescript"];
  return ["jsx"];
}

function previous(tokens: Token[], index: number) {
  return index > 0 ? tokens[index - 1] : undefined;
}

function isPunct(token: Token | undefined, ...values: string[]) {
  return token?.kind === "punct" && values.includes(token.value);
}

function isTauriName(value: string) {
  return value.includes("__TAURI");
}

function checkTokens(tokens: Token[]): CompileError | null {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const before = previous(tokens, index);
    const after = tokens[index + 1];
    if (token.kind === "name") {
      if (token.value === "import" && isPunct(after, "(") && !isPunct(before, ".", "?."))
        return { message: "Dynamische Imports sind in Plugins nicht erlaubt.", line: token.line };
      if (
        (token.value === "from" || token.value === "import") &&
        after?.kind === "string" &&
        !isPunct(before, ".", "?.") &&
        !(ALLOWED_IMPORTS as readonly string[]).includes(after.value)
      )
        return {
          message: `Import "${after.value}" ist nicht erlaubt. Erlaubt sind: react, @l8db/ui. Ein Plugin besteht aus genau einer Datei.`,
          line: after.line,
        };
      if (BLOCKED_PROPERTIES.has(token.value) || isTauriName(token.value))
        return { message: `"${token.value}" ist in Plugins nicht erlaubt.`, line: token.line };
      const member = isPunct(before, ".", "?.");
      const key = isPunct(before, "{", ",") && isPunct(after, ":");
      if (!member && !key && BLOCKED_GLOBALS.has(token.value))
        return {
          message: `"${token.value}" ist in Plugins nicht erlaubt. Nutze die Bausteine und ctx.http aus "@l8db/ui".`,
          line: token.line,
        };
    }
    if (
      (token.kind === "string" || token.kind === "template") &&
      (isTauriName(token.value) ||
        (isPunct(before, "[") &&
          isPunct(after, "]") &&
          (BLOCKED_PROPERTIES.has(token.value) || BLOCKED_GLOBALS.has(token.value))))
    )
      return { message: `"${token.value}" ist in Plugins nicht erlaubt.`, line: token.line };
  }
  return null;
}

function lineOf(code: string, offset: number) {
  let line = 1;
  for (let index = 0; index < offset; index++) if (code[index] === "\n") line++;
  return line;
}

function transformError(error: unknown): CompileError {
  const loc = (error as { loc?: { line?: number; column?: number } })?.loc;
  const message = error instanceof Error ? error.message : String(error);
  return {
    message: message.replace(/^Error transforming [^:]+:\s*/, "").replace(/\s*\(\d+:\d+\)$/, ""),
    line: loc?.line,
    column: loc?.column,
  };
}

export function checkPluginSource(source: string, fileName: string): CompileResult {
  if (source.length > MAX_SOURCE_LENGTH)
    return { ok: false, error: { message: "Die Datei ist größer als 256 KB." } };
  let esm: string;
  try {
    esm = transform(source, {
      transforms: sourceTransforms(fileName),
      jsxRuntime: "automatic",
      production: true,
      disableESTransforms: true,
      filePath: fileName,
    }).code;
  } catch (error) {
    return { ok: false, error: transformError(error) };
  }
  let tokens: Token[];
  try {
    tokens = tokenize(esm);
  } catch (error) {
    if (error instanceof ScanError)
      return { ok: false, error: { message: error.message, line: error.line } };
    throw error;
  }
  const blocked = checkTokens(tokens);
  if (blocked) return { ok: false, error: blocked };
  const element = BLOCKED_ELEMENTS.exec(esm);
  if (element)
    return {
      ok: false,
      error: {
        message: `<${element[2].toLowerCase()}> ist in Plugins nicht erlaubt. Nutze das style-Attribut oder die Bausteine aus "@l8db/ui".`,
        line: lineOf(esm, element.index),
      },
    };
  return { ok: true, code: esm };
}

export function compilePlugin(source: string, fileName: string): CompileResult {
  const checked = checkPluginSource(source, fileName);
  if (!checked.ok) return checked;
  try {
    const code = transform(checked.code, {
      transforms: ["imports"],
      production: true,
      disableESTransforms: true,
      filePath: fileName.replace(/\.(tsx|ts|jsx)$/, ".js"),
    }).code;
    return { ok: true, code };
  } catch (error) {
    return { ok: false, error: transformError(error) };
  }
}
