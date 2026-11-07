import { afterEach, expect, test } from "bun:test";
import type { ExtensionDescriptor } from "../src/lib/extensions/contracts";
import { dispatchRpc } from "../src/lib/extensions/manager/dispatch-rpc";
import type { RpcDeps } from "../src/lib/extensions/manager/rpc-context";
import { useOrganizationStore } from "../src/lib/organization-state";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

afterEach(() => useOrganizationStore.setState({ policy: null, error: null }));

test("invalid organization policy stops existing extension RPC before any service access", async () => {
  useOrganizationStore.setState({ error: "Richtlinie ungültig" });
  let accesses = 0;
  const deps = new Proxy(
    {},
    {
      get() {
        accesses++;
        throw new Error("Service accessed");
      },
    },
  ) as RpcDeps;
  const result = await measureScenario(async () => {
    for (let index = 0; index < 2000; index++) {
      await dispatchRpc(
        {} as ExtensionDescriptor,
        "network.fetch",
        ["https://example.invalid"],
        new Map(),
        deps,
      ).then(
        () => {
          throw new Error("RPC was allowed");
        },
        (error) => expect(error.message).toContain("IT-Richtlinie"),
      );
    }
  });
  expect(accesses).toBe(0);
  expect(result.p95Ms).toBeLessThan(250);
  reportScenario("organization-extension-rpc", {
    calls: 2000,
    serviceRequests: accesses,
    retainedSessions: 0,
    ...result,
  });
});
