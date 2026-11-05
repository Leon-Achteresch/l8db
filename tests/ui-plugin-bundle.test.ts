import { expect, test } from "bun:test";
import { applyBundle, encodeBundle, previewBundle } from "../src/lib/ui-plugins/bundle";

const check = async (name: string, source: string) => {
  if (source === "broken") throw new Error("Compilerfehler");
  return { id: name, http: ["https://example.org"] };
};
const entry = (name = "one.tsx", source = "valid") => ({
  name,
  source,
  options: { limit: 5 },
  requiredHttpHosts: [],
});
const bundle = (plugins: unknown[]) => ({ format: "l8db.ui-plugins", version: 1, plugins });

test("roundtrip preserves sources/options but never grants", async () => {
  expect(() => encodeBundle([])).toThrow();
  const text = encodeBundle([entry()]);
  expect(text).not.toContain("httpGrants");
  const [preview] = await previewBundle(JSON.parse(text), [], check);
  expect(preview.options).toEqual({ limit: 5 });
  expect(preview.requiredHttpHosts).toEqual(["https://example.org"]);
  expect(preview.before).toBeUndefined();
});

test("invalid entries do not block valid sources; conflicts retain before", async () => {
  const result = await previewBundle(
    bundle([
      entry("one.tsx", "new"),
      entry("two.tsx", "broken"),
      entry("../evil.tsx"),
      entry("ONE.tsx"),
      entry("big.tsx", "x".repeat(262145)),
      { ...entry("opts.tsx"), options: [] },
      entry("identical.tsx"),
    ]),
    [
      { name: "one.tsx", source: "old", modified: 0 },
      { name: "identical.tsx", source: "valid", modified: 0 },
    ],
    check,
  );
  expect(result[0].before).toBe("old");
  expect(result.slice(1, 6).every((e) => e.error)).toBe(true);
  expect(result[6].before).toBe(result[6].source);
});

test("rejects incompatible envelopes and bounded export", async () => {
  for (const value of [null, {}, { ...bundle([]), version: 2 }, bundle(Array(201).fill(entry()))])
    await expect(previewBundle(value, [], check)).rejects.toThrow();
  expect(() => encodeBundle([entry("big.tsx", "x".repeat(2097152))])).toThrow();
});

test("large bundle import/export budget and idle behavior", async () => {
  const plugins = Array.from({ length: 200 }, (_, i) => entry(`plugin-${i}.tsx`, "x".repeat(8000)));
  const samples: number[] = [];
  let calls = 0;
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const text = encodeBundle(plugins);
    expect(new TextEncoder().encode(text).length).toBeLessThan(2097152);
    const result = await previewBundle(JSON.parse(text), [], async (name) => {
      calls++;
      return { id: name };
    });
    expect(result.length).toBe(200);
    samples.push(performance.now() - start);
  }
  const before = calls;
  await Bun.sleep(20);
  expect(calls).toBe(before);
  samples.sort((a, b) => a - b);
  console.log(
    `Bundle 200 × 8KB, 30 runs: median ${samples[15].toFixed(2)} ms, p95 ${samples[28].toFixed(2)} ms; max 2 MiB input, 200 entries, serial compilation, zero idle calls`,
  );
  expect(samples[28]).toBeLessThan(250);
});

test("preview/cancel writes nothing; selection overwrites or skips and rejects stale conflicts", async () => {
  const current = [{ name: "one.tsx", source: "old", modified: 0 }];
  const entries = await previewBundle(
    bundle([entry("one.tsx", "new"), entry("two.tsx")]),
    current,
    check,
  );
  const written: string[] = [];
  expect(written).toEqual([]);
  await applyBundle(entries, new Set(), current, check, async (e) => {
    written.push(e.name);
  });
  expect(written).toEqual([]);
  await applyBundle(entries, new Set(["one.tsx"]), current, check, async (e) => {
    written.push(e.name);
  });
  expect(written).toEqual(["one.tsx"]);
  await expect(
    applyBundle(entries, new Set(["one.tsx"]), [], check, async () => {
      throw new Error("must not write");
    }),
  ).rejects.toThrow("inzwischen");
});

test("installierte ID unter anderem Dateinamen blockiert Vorschau und Anwendung", async () => {
  const sameId = async () => ({ id: "shared" });
  const current = [{ name: "local.tsx", source: "old", modified: 0 }];
  const [preview] = await previewBundle(bundle([entry("new.tsx")]), current, sameId);
  expect(preview.error).toContain("anderem Dateinamen");
  const [fresh] = await previewBundle(bundle([entry("new.tsx")]), [], sameId);
  let writes = 0;
  await expect(
    applyBundle([fresh], new Set(["new.tsx"]), current, sameId, async () => {
      writes++;
    }),
  ).rejects.toThrow();
  expect(writes).toBe(0);
});
