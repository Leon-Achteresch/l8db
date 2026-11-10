import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StartupView } from "../src/features/shell/startup-view";
import { BOOT_PAINT_KEY, initBootPaint, rememberBootPaint } from "../src/lib/boot-paint";

function fakeWindow(vars: Record<string, string>, dark = false, theme: string | null = null) {
  const items = new Map<string, string>(theme ? [["theme", theme]] : []);
  const counts = { reads: 0, writes: 0, observers: 0 };
  let notify = () => {};
  const target = {
    document: {
      documentElement: { classList: { contains: (name: string) => dark && name === "dark" } },
    },
    getComputedStyle: () => {
      counts.reads++;
      return { getPropertyValue: (name: string) => vars[name] ?? "" };
    },
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        counts.writes++;
        items.set(key, value);
      },
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {
        counts.observers++;
      }
      disconnect() {
        counts.observers--;
        notify = () => {};
      }
    },
  };
  return {
    target: target as unknown as Window & typeof globalThis,
    items,
    counts,
    mutate: () => notify(),
    setDark: (value: boolean) => {
      dark = value;
    },
  };
}

const LIGHT = {
  "--background": " oklch(0.975 calc(0.004 * 1) 248)",
  "--foreground": "oklch(0.22 0.012 248)",
  "--card": "oklch(0.995 0.002 248)",
  "--border": "oklch(0.89 0.008 248)",
  "--primary": "oklch(0.4 0.12 248)",
};

test("boot paint stores the resolved theme colours once", () => {
  const fake = fakeWindow(LIGHT, true, "dark");
  rememberBootPaint(fake.target);
  rememberBootPaint(fake.target);
  expect(fake.counts.writes).toBe(1);
  expect(JSON.parse(fake.items.get(BOOT_PAINT_KEY) ?? "null")).toEqual({
    theme: "dark",
    mode: "dark",
    vars: {
      bg: "oklch(0.975 calc(0.004 * 1) 248)",
      fg: "oklch(0.22 0.012 248)",
      card: "oklch(0.995 0.002 248)",
      line: "oklch(0.89 0.008 248)",
      accent: "oklch(0.4 0.12 248)",
    },
  });
});

test("boot paint skips an unstyled document", () => {
  const fake = fakeWindow({});
  rememberBootPaint(fake.target);
  expect(fake.counts.writes).toBe(0);
});

test("boot paint batches 10,000 theme mutations into one style read and stays idle afterwards", async () => {
  const fake = fakeWindow(LIGHT);
  const dispose = initBootPaint(fake.target, 5);
  const started = performance.now();
  for (let index = 0; index < 10_000; index++) fake.mutate();
  const scheduling = performance.now() - started;
  await Bun.sleep(30);
  expect(fake.counts).toEqual({ reads: 1, writes: 1, observers: 1 });
  expect(scheduling).toBeLessThan(50);
  await Bun.sleep(30);
  expect(fake.counts.reads).toBe(1);
  fake.setDark(true);
  fake.mutate();
  await Bun.sleep(30);
  expect(fake.counts).toEqual({ reads: 2, writes: 2, observers: 1 });
  expect(JSON.parse(fake.items.get(BOOT_PAINT_KEY) ?? "null").mode).toBe("dark");
  fake.mutate();
  dispose();
  await Bun.sleep(30);
  expect(fake.counts).toEqual({ reads: 2, writes: 2, observers: 0 });
});

async function runBootScript(stored: string | null, systemDark: boolean) {
  const html = await Bun.file(resolve(import.meta.dir, "../index.html")).text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  const classes = new Set<string>();
  const style = new Map<string, string>();
  new Function("document", "localStorage", "matchMedia", scripts[0][1])(
    {
      documentElement: {
        classList: { add: (name: string) => classes.add(name) },
        style: { setProperty: (name: string, value: string) => style.set(name, value) },
      },
    },
    { getItem: () => stored },
    () => ({ matches: systemDark }),
  );
  return { dark: classes.has("dark"), style: Object.fromEntries(style) };
}

test("boot script follows the system without a cache", async () => {
  expect(await runBootScript(null, true)).toEqual({ dark: true, style: {} });
  expect(await runBootScript(null, false)).toEqual({ dark: false, style: {} });
  expect(await runBootScript("{broken", true)).toEqual({ dark: true, style: {} });
  expect(await runBootScript("null", false)).toEqual({ dark: false, style: {} });
});

test("boot script applies cached colours only for the matching mode", async () => {
  const cache = (theme: string, mode: string) =>
    JSON.stringify({ theme, mode, vars: { bg: "black", fg: "white", extra: "x", card: 1 } });
  expect(await runBootScript(cache("dark", "dark"), false)).toEqual({
    dark: true,
    style: { "--boot-bg": "black", "--boot-fg": "white" },
  });
  expect(await runBootScript(cache("system", "dark"), false)).toEqual({ dark: false, style: {} });
  expect(await runBootScript(cache("system", "dark"), true)).toEqual({
    dark: true,
    style: { "--boot-bg": "black", "--boot-fg": "white" },
  });
  expect(await runBootScript(cache("light", "light"), true)).toEqual({
    dark: false,
    style: { "--boot-bg": "black", "--boot-fg": "white" },
  });
});

test("index.html and StartupView render the same boot shell", async () => {
  const html = await Bun.file(resolve(import.meta.dir, "../index.html")).text();
  const shell = html.match(/<main class="boot-shell"[\s\S]*?<\/main>/)?.[0] ?? "";
  const normalize = (markup: string) =>
    markup
      .replace(/\s+/g, " ")
      .replace(/<(\w+)([^>]*?)\s*\/>/g, "<$1$2></$1>")
      .replace(/>\s+/g, ">")
      .replace(/\s+</g, "<")
      .replace(/\s+>/g, ">");
  expect(normalize(shell)).toBe(normalize(renderToStaticMarkup(createElement(StartupView))));
});
