import { PLUGIN_GLOBALS } from "./globals";
import { lockdownRealm } from "./lockdown";
import { tokenize } from "./scan";

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
]);

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

let base: Readonly<Record<string, unknown>> | null = null;

function baseScope() {
  if (base) return base;
  const scope = globalThis as Record<string, unknown>;
  const host = console as unknown as Record<string, (...args: unknown[]) => void>;
  const values: Record<string, unknown> = Object.create(null);
  for (const name of PLUGIN_GLOBALS) values[name] = scope[name];
  values.console = Object.freeze(
    Object.fromEntries(
      CONSOLE_METHODS.map((name) => [name, (...args: unknown[]) => host[name](...args)]),
    ),
  );
  base = Object.freeze(values);
  return base;
}

function referencedNames(code: string) {
  const names = new Set<string>();
  let previous = "";
  for (const token of tokenize(code)) {
    if (token.kind === "name" && previous !== "." && previous !== "?.") names.add(token.value);
    previous = token.kind === "punct" ? token.value : "";
  }
  return names;
}

export function evaluatePlugin(
  code: string,
  modules: Readonly<Record<string, unknown>>,
  globals: Readonly<Record<string, unknown>> = {},
): unknown {
  lockdownRealm();
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new Error(`Import "${name}" ist nicht erlaubt. Erlaubt sind: react, @l8db/ui.`);
  };
  const values: Record<string, unknown> = Object.create(null);
  Object.assign(values, baseScope(), globals, { require, module, exports: module.exports });
  const names = [...new Set([...Object.keys(values), ...referencedNames(code)])].filter(
    (name) => IDENTIFIER.test(name) && !RESERVED.has(name),
  );
  const factory = new Function(...names, `return function () { "use strict";\n${code}\n};`);
  factory(...names.map((name) => values[name])).call(undefined);
  return Object.hasOwn(module.exports, "default") ? module.exports.default : module.exports;
}
