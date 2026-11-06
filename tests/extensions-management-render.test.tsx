import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommunityExtensionCard } from "../src/features/community-extensions/community-extension-card";
import { UiPluginCard } from "../src/features/ui-plugins/settings/ui-plugin-card";
import type { ExtensionDescriptor } from "../src/lib/extensions/contracts";
import { extensionPage } from "../src/lib/extensions/management-page";
import type { ExtensionManager } from "../src/lib/extensions/manager";
import { ExtensionHostContext } from "../src/lib/extensions/react-context";
import type { UiPluginStatus } from "../src/lib/ui-plugins/status";

Object.assign(window, { addEventListener() {}, removeEventListener() {} });

const full: ExtensionDescriptor[] = Array.from({ length: 50 }, (_, id) => ({
  archive: {
    format: 1,
    manifest: {
      id: `test.full${id}`,
      name: `Full ${id}`,
      publisher: "test",
      version: "1.0.0",
      engines: { l8db: "*" },
      main: "index.js",
      activationEvents: [],
      permissions: ["database:read"],
    },
    files: { "index.js": "" },
  },
  enabled: false,
  grants: [],
  configuration: {},
  state: "discovered",
}));
const light: UiPluginStatus[] = Array.from({ length: 200 }, (_, id) => ({
  file: `light${id}.tsx`,
  id: `light${id}`,
  state: "active",
  slotErrors: {},
  tripped: {},
  http: [],
  granted: [],
  options: {},
}));
const host = { permissions: { supported: [] } } as unknown as ExtensionManager;

test("mixed management cards render bounded pages with stages, rights, sources and controls", () => {
  const samples: number[] = [];
  let maxNodes = 0;
  for (let run = 0; run < 30; run++) {
    const start = performance.now();
    for (const page of [0, 2]) {
      const visible = extensionPage(full, light, page);
      const html = renderToStaticMarkup(
        createElement(
          ExtensionHostContext.Provider,
          { value: host },
          createElement(
            "div",
            {},
            ...visible.full.map((extension) =>
              createElement(CommunityExtensionCard, {
                key: extension.archive.manifest.id,
                extension,
                run: () => {},
              }),
            ),
            ...visible.light.map((status) =>
              createElement(UiPluginCard, { key: status.file, status, onRemove: () => {} }),
            ),
          ),
        ),
      );
      expect(html.match(/<article/g)?.length).toBe(25);
      expect(html).toContain(page === 0 ? "Voll" : "Leicht");
      expect(html).toContain("Eigene");
      expect(html).toContain(page === 0 ? "database:read" : "Aktiv");
      maxNodes = Math.max(maxNodes, (html.match(/<[a-z][^>]*>/g) ?? []).length);
    }
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `250 installed, 2 representative pages SSR: median ${samples[15].toFixed(2)}ms, p95 ${samples[28].toFixed(2)}ms, max ${maxNodes} HTML elements/page`,
  );
  expect(samples[28]).toBeLessThan(250);
  expect(maxNodes).toBeLessThan(3000);
});
