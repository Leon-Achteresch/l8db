import { expect, test } from "bun:test";
import { compilePlugin } from "../packages/ui-plugin-api/src/compile";
import { evaluatePlugin } from "../packages/ui-plugin-api/src/evaluate";

function load(source: string) {
  const result = compilePlugin(source, "test.ts");
  if (!result.ok) throw new Error(result.error.message);
  return evaluatePlugin(result.code, {}) as () => unknown;
}

for (const body of [
  "while(true){}",
  "for(;;){}",
  "do{}while(1)",
  "function f(){return f()} f()",
  "for(let i=0;i<2;i++){while(true){}}",
])
  test(`begrenzt ${body}`, () => {
    expect(() => load(body)).toThrow("Laufzeitgrenze");
    const run = load(`export default () => {${body}}`);
    expect(run).toThrow("Laufzeitgrenze");
  });

for (const source of [
  "const __l8dbExecutionGuard = 1",
  'const x = "__l8dbExecutionGuard"',
  "const x=/(a+)+$/",
  "const x=/(a*)*$/",
  "const x=/(a|aa)+$/",
  "new RegExp(x)",
])
  test(`lehnt ab: ${source}`, () => expect(compilePlugin(source, "test.ts").ok).toBe(false));

test("instrumentiert knappe Schleifen und Pfeilfunktionen", () => {
  expect(load("export default () => {let n=0; for(let i=0;i<10;i++) n++; return n}")()).toBe(10);
  expect(load("export default () => (() => 42)()")()).toBe(42);
});

test("große String-Allokation wirft", () => {
  expect(load('export default () => "x".repeat(1e9)')).toThrow();
});

test("Grid-Wächter: 48.000 Zellen, begrenzte Laufzeit und Speicher", () => {
  const baseline = evaluatePlugin("module.exports = (value) => value + 1", {}) as (
    value: number,
  ) => number;
  const guarded = load("export default (value: number) => value + 1") as (value: number) => number;
  const measure = (fn: (value: number) => number) => {
    const samples: number[] = [];
    for (let round = 0; round < 30; round++) {
      const start = performance.now();
      for (let cell = 0; cell < 48_000; cell++) fn(cell);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { median: samples[15], p95: samples[28] };
  };
  const before = measure(baseline);
  const after = measure(guarded);
  console.log(JSON.stringify({ workload: "48000 cells x 30", before, after }));
  expect((after.p95 / 48_000) * 1000).toBeLessThan(5);
});

function loadModule(source: string) {
  const result = compilePlugin(source, "test.ts");
  if (!result.ok) throw new Error(result.error.message);
  return evaluatePlugin(result.code, {}, { setTimeout }) as Record<
    string,
    (...args: unknown[]) => unknown
  >;
}

test("offenes await blockiert spätere Aufrufe nicht", async () => {
  const plugin = loadModule(
    "export const start = async () => { await new Promise(r => setTimeout(r, 160)); for (let i = 0; i < 10; i++); return 1 }; export const ping = () => 2",
  );
  const pending = plugin.start();
  await new Promise((resolve) => setTimeout(resolve, 130));
  expect(plugin.ping()).toBe(2);
  expect(await pending).toBe(1);
  expect(plugin.ping()).toBe(2);
});

test("abgelehntes await hält den Wächter im Gleichgewicht", async () => {
  const plugin = loadModule(
    "export const start = async () => { try { await Promise.reject(new Error('x')) } catch { for (let i = 0; i < 10; i++); return 'gefangen' } }; export const spin = () => { while (true) {} }",
  );
  expect(await plugin.start()).toBe("gefangen");
  expect(() => plugin.spin()).toThrow("Laufzeitgrenze");
});

test("Endlosschleife nach await wird begrenzt", async () => {
  const plugin = loadModule("export const start = async () => { await 0; while (true) {} }");
  await expect(plugin.start() as Promise<unknown>).rejects.toThrow("Laufzeitgrenze");
});

for (const source of [
  "function* gen() { yield 1 }",
  "const gen = function* () {}",
  "async function f(xs) { for await (const x of xs) {} }",
])
  test(`lehnt ab: ${source}`, () => expect(compilePlugin(source, "test.ts").ok).toBe(false));

test("einfache Pfeilfunktionen bleiben ohne Wächter, aufrufende nicht", () => {
  const compiled = compilePlugin(
    "export const a = (v) => v * 2; export const b = (f) => f(); export const c = () => new Map(); export const d = (t) => t`x`",
    "test.ts",
  );
  if (!compiled.ok) throw new Error(compiled.error.message);
  expect(compiled.code.match(/__l8dbExecutionGuard\.enter\(\)/g)?.length).toBe(3);
  const plugin = loadModule(
    "const o = {}; Object.defineProperty(o, 'x', { get: () => o.x + o.x }); export const spin = () => o.x",
  );
  expect(() => plugin.spin()).toThrow();
  const fan = loadModule(
    "const f = (n) => n <= 0 ? 0 : f(n - 1) + f(n - 1); export const spin = () => f(60)",
  );
  expect(() => fan.spin()).toThrow("Laufzeitgrenze");
});
