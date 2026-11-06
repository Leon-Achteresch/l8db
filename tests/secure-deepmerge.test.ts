import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const shadcn = createRequire(realpathSync(resolve("node_modules/shadcn/dist/index.js")));
const merge = shadcn("deepmerge") as typeof import("../packages/secure-deepmerge/index.cjs");

function poison() {
  return JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":{"value":42}}',
  );
}

function assertSafe(value: Record<string, unknown>) {
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(value.polluted).toBeUndefined();
  for (const key of ["__proto__", "constructor", "prototype"]) {
    expect(Object.hasOwn(value, key)).toBe(false);
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
}

test("shadcn resolves the maintained security fork with no audit exceptions", () => {
  const entry = realpathSync(shadcn.resolve("deepmerge"));
  expect(shadcn("deepmerge/package.json").name).toBe("@l8db/secure-deepmerge");
  expect(readFileSync(entry, "utf8")).toBe(
    readFileSync("packages/secure-deepmerge/index.cjs", "utf8"),
  );
  const registry = createRequire(shadcn.resolve("@shadcn/registry"));
  expect(registry.resolve("deepmerge")).toBe(entry);
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(workflow).toContain("run: bun audit\n");
  expect(workflow).toContain("run: cargo audit\n");
  expect(workflow).not.toMatch(/audit[^\n]*--ignore/);
  expect(readFileSync("src-tauri/Cargo.lock", "utf8")).not.toContain('name = "rsa"\n');
});

test("rejects poisoning through source, target, null prototypes, arrays and merge.all", () => {
  for (const target of [{}, Object.create(null), poison()]) {
    for (const source of [poison(), Object.assign(Object.create(null), poison())]) {
      const result = merge(target, source);
      assertSafe(result);
      expect(result.safe).toEqual({ value: 42 });
      assertSafe(merge({ nested: target }, { nested: source }).nested);
      assertSafe(merge([], [source])[0]);
      assertSafe(merge.all([target, source]));
    }
  }
  const inherited = Object.create({ inherited: "secret" });
  inherited.own = true;
  expect(merge({}, inherited)).toEqual({ own: true });
});

test("preserves deepmerge configuration API, symbols, cloning and array behavior", () => {
  const symbol = Symbol("config");
  const target = Object.freeze({ list: [{ a: 1 }], nested: { a: 1 }, [symbol]: { a: 1 } });
  const source = Object.freeze({ list: [{ b: 2 }], nested: { b: 2 }, [symbol]: { b: 2 } });
  const result = merge(target, source);
  expect(result.list).toEqual([{ a: 1 }, { b: 2 }]);
  expect(result.list[0]).not.toBe(target.list[0]);
  expect(result.nested).toEqual({ a: 1, b: 2 });
  expect(result[symbol]).toEqual({ a: 1, b: 2 });
  expect(merge(target, source, { arrayMerge: (_, next) => next }).list).toBe(source.list);
  expect(merge({}, target, { clone: false }).nested).toBe(target.nested);
  expect(
    merge(
      { nested: { a: 1 } },
      { nested: { b: 2 } },
      {
        customMerge: (key) => (key === "nested" ? () => ({ custom: true }) : undefined),
      },
    ),
  ).toEqual({ nested: { custom: true } });
  const date = new Date();
  expect(merge({}, { date }).date).toBe(date);
  expect(() => merge.all({} as never)).toThrow();
});

test("large configuration merges stay within latency and output budgets without idle work", async () => {
  const input = Object.fromEntries(
    Array.from({ length: 5_000 }, (_, i) => [
      `component-${i}`,
      { enabled: true, variants: ["small", "large"], nested: { index: i } },
    ]),
  );
  const patch = Object.fromEntries(
    Object.keys(input).map((key) => [key, { nested: { updated: true } }]),
  );
  const samples: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    const result = merge(input, patch);
    samples.push(performance.now() - start);
    expect(Object.keys(result).length).toBe(5_000);
    bytes = Buffer.byteLength(JSON.stringify(result));
    expect(bytes).toBeLessThan(1_000_000);
  }
  samples.sort((a, b) => a - b);
  expect(samples[10]).toBeLessThan(100);
  expect(samples[19]).toBeLessThan(250);
  const snapshot = JSON.stringify(input);
  await Bun.sleep(20);
  expect(JSON.stringify(input)).toBe(snapshot);
  console.log(
    `secure-deepmerge: 5000 components, median=${samples[10].toFixed(2)}ms p95=${samples[19].toFixed(2)}ms output=${bytes}B; synchronous, 0 requests/background tasks`,
  );
});
