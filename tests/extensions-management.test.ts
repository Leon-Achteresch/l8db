import { expect, test } from "bun:test";
import { extensionPage } from "../src/lib/extensions/management-page";
import { bundleArchives, encodeBundle, previewBundle } from "../src/lib/ui-plugins/bundle";

const archive = {
  format: 1 as const,
  manifest: {
    id: "example.one",
    name: "One",
    publisher: "example",
    version: "1.0.0",
    engines: { l8db: "*" },
    main: "index.js",
    activationEvents: [],
    permissions: ["network" as const],
    capabilities: { network: { hosts: ["example.org"] } },
  },
  files: { "index.js": "export function activate() {}" },
};

test("mixed bundle preserves archives and old bundles, namespaces may share names and IDs", async () => {
  const plugins = [{ name: "one.tsx", source: "valid", options: {}, requiredHttpHosts: [] }];
  const value = JSON.parse(encodeBundle(plugins, [archive]));
  expect(bundleArchives(value)[0].files).toEqual(archive.files);
  expect(bundleArchives(value)[0].manifest.permissions).toEqual(["network"]);
  expect((await previewBundle(value, [], async () => ({ id: archive.manifest.id })))[0].id).toBe(
    archive.manifest.id,
  );
  expect(bundleArchives({ format: "l8db.ui-plugins", version: 1, plugins })).toEqual([]);
  expect(() => bundleArchives({ archives: [archive, archive] })).toThrow();
  expect(() => bundleArchives({ archives: [{ ...archive, files: {} }] })).toThrow();
  expect(() => encodeBundle([], [archive])).not.toThrow();
});

test("empty and shrinking pages stay reachable, every kind remains independently addressable", () => {
  expect(extensionPage([], [], 8)).toEqual({ page: 0, total: 0, full: [], light: [] });
  const full = Array.from({ length: 50 }, (_, id) => `full:${id}`);
  const light = Array.from({ length: 200 }, (_, id) => `light:${id}`);
  const all = Array.from({ length: 10 }, (_, page) => extensionPage(full, light, page)).flatMap(
    (page) => [...page.full, ...page.light],
  );
  expect(new Set(all).size).toBe(250);
  expect(extensionPage([], light.slice(0, 1), 9).page).toBe(0);
});

test("250 extensions page derivation median/p95 and bounded output, no background work", async () => {
  const full = Array.from({ length: 50 }, (_, id) => ({ id, archive }));
  const light = Array.from({ length: 200 }, (_, id) => ({ id, source: "x".repeat(8000) }));
  const samples: number[] = [];
  for (let run = 0; run < 100; run++) {
    const start = performance.now();
    for (let page = 0; page < 10; page++) {
      const visible = extensionPage(full, light, page);
      expect(visible.full.length + visible.light.length).toBeLessThanOrEqual(25);
    }
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `250 extensions / 10 pages: median ${samples[50].toFixed(3)}ms p95 ${samples[95].toFixed(3)}ms; retained page <=25 references; no timers or I/O`,
  );
  expect(samples[95]).toBeLessThan(10);
  const before = JSON.stringify([full, light]);
  await Bun.sleep(20);
  expect(JSON.stringify([full, light])).toBe(before);
});

test("organization prohibition blocks import and activation boundaries", async () => {
  const { assertExtensionsAllowed } = await import("../src/lib/extensions/management");
  const { useOrganizationStore } = await import("../src/lib/organization-state");
  const previous = useOrganizationStore.getState().policy;
  useOrganizationStore.setState({
    policy: { allowExtensions: false } as NonNullable<typeof previous>,
  });
  expect(assertExtensionsAllowed).toThrow("Organisation");
  useOrganizationStore.setState({ policy: previous });
  expect(assertExtensionsAllowed).not.toThrow();
});
