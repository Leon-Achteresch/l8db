import { expect, test } from "bun:test";
import { create } from "zustand";
import { useOrganizationStore, withOrganizationSettings } from "../src/lib/organization-state";
import { reportSecretStorage, useSecretStorageStatus } from "../src/lib/secret-storage-status";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("10,000 managed setting writes remain bounded without background or database work", async () => {
  useOrganizationStore.setState({
    policy: {
      managed: true,
      path: "/etc/l8db/policy.json",
      organization: "Test",
      support: "IT",
      settings: { productionReadOnly: true, usageMetrics: false },
      allowAi: false,
      allowExtensions: false,
      allowPersonalSync: false,
      allowMcp: false,
      connections: [],
    },
  });
  const store = create(
    withOrganizationSettings<{ productionReadOnly: boolean; usageMetrics: boolean }>(() => ({
      productionReadOnly: false,
      usageMetrics: true,
    })),
  );
  let notifications = 0;
  const dispose = store.subscribe(() => {
    notifications++;
  });
  const result = await measureScenario(() => {
    for (let index = 0; index < 10000; index++) store.setState({ productionReadOnly: false });
  });
  expect(store.getState()).toEqual({ productionReadOnly: true, usageMetrics: false });
  expect(result.p95Ms).toBeLessThan(100);
  const before = notifications;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(notifications).toBe(before);
  dispose();
  useOrganizationStore.setState({ policy: null });
  reportScenario("organization-settings", {
    writes: 10000,
    retainedSettings: Object.keys(store.getState()).length,
    databaseRequests: 0,
    idleNotifications: 0,
    ...result,
  });
});

test("10,000 failed secret writes retain at most 128 diagnostic account IDs", async () => {
  const result = await measureScenario(() => {
    for (let index = 0; index < 10000; index++) reportSecretStorage(`account-${index}`, false);
  });
  expect(useSecretStorageStatus.getState().failedAccounts.length).toBeLessThanOrEqual(128);
  expect(JSON.stringify(useSecretStorageStatus.getState()).length).toBeLessThan(4096);
  expect(result.p95Ms).toBeLessThan(100);
  reportScenario("secret-failure-diagnostics", { accounts: 10000, retainedLimit: 128, ...result });
  useSecretStorageStatus.setState({ failedAccounts: [] });
});
