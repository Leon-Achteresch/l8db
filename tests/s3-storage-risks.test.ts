import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const { featureAvailable, featureById } = await import("../src/lib/discovery/catalog");
const { isPublicPolicy, lifecycleDeletions, storageClassLabel } = await import(
  "../src/features/storage/storage-risks"
);
const { emptyLifecycleRule, policyPreset } = await import("../src/lib/storage/s3");

import type { Capabilities } from "../src/lib/db";

describe("S3-Risiken", () => {
  test("erkennt öffentliche Policies", () => {
    expect(isPublicPolicy(policyPreset("b", "public-read") ?? "")).toBe(true);
    expect(isPublicPolicy(policyPreset("b", "public-read-write") ?? "")).toBe(true);
    expect(
      isPublicPolicy(
        JSON.stringify({ Statement: { Effect: "Allow", Principal: "*", Action: "s3:GetObject" } }),
      ),
    ).toBe(true);
    expect(
      isPublicPolicy(
        JSON.stringify({
          Statement: [{ Effect: "Allow", Principal: { AWS: ["arn:aws:iam::1:root"] } }],
        }),
      ),
    ).toBe(false);
    expect(
      isPublicPolicy(JSON.stringify({ Statement: [{ Effect: "Deny", Principal: "*" }] })),
    ).toBe(false);
    expect(isPublicPolicy("{kaputt")).toBe(false);
  });

  test("fasst löschende Lifecycle-Regeln zusammen", () => {
    const keep = { ...emptyLifecycleRule(0), expirationDays: null };
    const logs = { ...emptyLifecycleRule(1), prefix: "logs/", expirationDays: 30 };
    const off = { ...emptyLifecycleRule(2), expirationDays: 1, enabled: false };
    const old = { ...emptyLifecycleRule(3), expirationDays: null, noncurrentDays: 5 };
    expect(lifecycleDeletions([keep])).toEqual([]);
    expect(lifecycleDeletions([keep, logs, off, old])).toEqual([
      "„logs/“: Objekte nach 30 Tagen",
      "Ganzer Bucket: alte Versionen nach 5 Tagen",
    ]);
  });

  test("Speicherklassen haben Anzeigenamen", () => {
    expect(storageClassLabel("DEEP_ARCHIVE")).toBe("Tiefenarchiv (Deep Archive)");
    expect(storageClassLabel("CUSTOM_TIER")).toBe("CUSTOM_TIER");
  });

  test("SQL-Funktionen sind bei Objektspeicher ausgeblendet", () => {
    const s3 = { query_language: "sql", object_storage: true } as Capabilities;
    const pg = { query_language: "sql", object_storage: false } as Capabilities;
    for (const id of ["notebook", "query-builder"]) {
      const entry = featureById(id);
      expect(entry).toBeDefined();
      if (!entry) continue;
      expect(featureAvailable(entry, { capabilities: s3 })).toBe(false);
      expect(featureAvailable(entry, { capabilities: pg })).toBe(true);
    }
  });
});
