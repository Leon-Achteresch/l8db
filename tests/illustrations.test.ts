import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/components/illustration.tsx"), "utf8");
const names = [...source.matchAll(/\|\s*"([a-z-]+)"/g)].map((match) => match[1]);

describe("illustrations", () => {
  test("every name ships one small webp", () => {
    expect(names.length).toBeGreaterThanOrEqual(8);
    let total = 0;
    for (const name of names) {
      const bytes = statSync(resolve(root, `public/illustrations/${name}.webp`)).size;
      expect(bytes).toBeLessThanOrEqual(120 * 1024);
      total += bytes;
    }
    expect(total).toBeLessThanOrEqual(800 * 1024);
  });

  test("images stay out of the javascript bundle and load lazily", () => {
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('decoding="async"');
    expect(source).not.toMatch(/import .*\.webp/);
  });
});
