import { expect, test } from "bun:test";
import { stableJson } from "../src/lib/extensions/manager/extension-manager-base";

test("Management vergleicht verschachtelte Objekte unabhängig von Schlüsselreihenfolge", () => {
  expect(stableJson({ archive: { z: 1, a: { y: 2, x: 3 } }, enabled: true })).toBe(
    stableJson({ enabled: true, archive: { a: { x: 3, y: 2 }, z: 1 } }),
  );
  expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
});

test("Löschen fragt vor dem Dateizugriff, Banner erklärt den Modus", async () => {
  const source = await Bun.file(
    new URL("../src/features/ui-plugins/settings/ui-plugins-section.tsx", import.meta.url),
  ).text();
  expect(source.indexOf("await confirm(")).toBeLessThan(source.indexOf("await removeUiPlugin("));
  expect(source.match(/Abgesicherter Modus:/g)).toHaveLength(1);
});

test("Bundle-Rundlauf überspringt bereits installierte volle Erweiterungen", async () => {
  const source = await Bun.file(
    new URL("../src/features/ui-plugins/settings/ui-plugin-bundle.tsx", import.meta.url),
  ).text();
  expect(source).toContain("setArchives(available)");
  expect(source).toContain("full.filter");
  expect(source).not.toContain("Volle Erweiterung bereits installiert.");
});

test("verwaistes Badge entfällt, Vorschläge halten nur offene Cache-Einträge", async () => {
  const features = await Bun.file(new URL("../src/lib/new-features.ts", import.meta.url)).text();
  expect(features).not.toContain('"settings.extensions.ui-plugins":');
  const source = await Bun.file(
    new URL("../src/features/ui-plugins/plugin-proposals.tsx", import.meta.url),
  ).text();
  expect(source).toContain("cache.delete(key)");
  expect(source).toContain("checked.source !== request.source");
});
