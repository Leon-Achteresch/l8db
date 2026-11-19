import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommunityExtensionCard } from "../src/features/community-extensions/community-extension-card";
import type { ExtensionDescriptor } from "../src/lib/extensions/contracts";
import type { ExtensionManager } from "../src/lib/extensions/manager";
import { ExtensionHostContext } from "../src/lib/extensions/react-context";

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
const host = { permissions: { supported: [] } } as unknown as ExtensionManager;

test("installed extension cards render with stages, rights, sources and controls", () => {
  const samples: number[] = [];
  let maxNodes = 0;
  for (let run = 0; run < 30; run++) {
    const start = performance.now();
    const html = renderToStaticMarkup(
      createElement(
        ExtensionHostContext.Provider,
        { value: host },
        createElement(
          "div",
          {},
          ...full.map((extension) =>
            createElement(CommunityExtensionCard, {
              key: extension.archive.manifest.id,
              extension,
              run: () => {},
            }),
          ),
        ),
      ),
    );
    expect(html.match(/<article/g)?.length).toBe(50);
    expect(html).toContain("Voll");
    expect(html).toContain("Eigene");
    expect(html).toContain("database:read");
    maxNodes = Math.max(maxNodes, (html.match(/<[a-z][^>]*>/g) ?? []).length);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `50 installed extensions SSR: median ${samples[15].toFixed(2)}ms, p95 ${samples[28].toFixed(2)}ms, max ${maxNodes} HTML elements`,
  );
  expect(samples[28]).toBeLessThan(250);
  expect(maxNodes).toBeLessThan(3000);
});
