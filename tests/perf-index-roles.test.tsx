import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IndexRoleDetails } from "../src/features/table/table-indexes-list/index-role-details";
import type { IndexRoles } from "../src/lib/db/schema-objects";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("500 wide index metadata rows retain a bounded initial role DOM without native reads", async () => {
  const roles: IndexRoles = {
    keys: [
      { name: "tenant", position: 1, descending: false },
      { name: "created", position: 2, descending: true },
    ],
    included: Array.from({ length: 128 }, (_, i) => `payload_${i}`),
    other: [],
    filter: { state: "known", predicate: "[active]=(1)" },
    definition_status: "reconstructed",
  };
  const render = () =>
    renderToStaticMarkup(
      createElement(
        "div",
        null,
        Array.from({ length: 500 }, (_, i) =>
          createElement(IndexRoleDetails, {
            key: i,
            roles,
            definition: "CREATE INDEX … INCLUDE (…) WHERE …",
          }),
        ),
      ),
    );
  let nodes = 0;
  let htmlBytes = 0;
  const run = () => {
    const html = render();
    nodes = (html.match(/data-index-column=/g) ?? []).length;
    htmlBytes = Buffer.byteLength(html);
    expect(nodes).toBe(500 * 10);
    expect(htmlBytes).toBeLessThan(4 * 1024 * 1024);
  };
  const times = await measureScenario(run, 9);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let round = 0; round < 5; round++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("index-role-details", {
    indexes: 500,
    includedPerIndex: 128,
    initialColumnNodes: nodes,
    htmlBytes,
    ...times,
    retainedBytes,
    nativeRequests: 0,
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramBytes: totalmem(),
      bun: Bun.version,
    },
  });
  expect(times.medianMs).toBeLessThan(250);
  expect(times.p95Ms).toBeLessThan(500);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
});
