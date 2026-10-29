import { SHADOWED_GLOBALS } from "./globals";

export function evaluatePlugin(
  code: string,
  modules: Readonly<Record<string, unknown>>,
  globals: Readonly<Record<string, unknown>> = {},
): unknown {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new Error(`Import "${name}" ist nicht erlaubt. Erlaubt sind: react, @l8db/ui.`);
  };
  const shadowed = SHADOWED_GLOBALS.filter((name) => !Object.hasOwn(globals, name));
  const names = [...shadowed, ...Object.keys(globals), "require", "module", "exports"];
  const values = [
    ...shadowed.map(() => undefined),
    ...Object.values(globals),
    require,
    module,
    module.exports,
  ];
  const factory = new Function(...names, `return function () {\n${code}\n};`);
  factory(...values).call(undefined);
  return Object.hasOwn(module.exports, "default") ? module.exports.default : module.exports;
}
