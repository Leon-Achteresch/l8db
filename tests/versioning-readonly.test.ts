import { expect, test } from "bun:test";
import { registerReadOnlyResolver } from "../src/lib/db/core";
import { versioningControl, versioningRun, versioningRunFleet } from "../src/lib/db/versioning";

test("versioning mutation entry points preserve explicit and active read-only modes", async () => {
  for (const explicit of [true, false]) {
    const previous = registerReadOnlyResolver(() => !explicit);
    try {
      const request = {
        connection: {
          connectionString: "postgresql://readonly@example.invalid/product",
          readOnly: explicit,
        },
      };
      await expect(versioningRun(request)).rejects.toThrow("schreibgeschützt");
      await expect(versioningRunFleet([request])).rejects.toThrow("schreibgeschützt");
      for (const action of [
        "initialize",
        "lock",
        "baseline-lock",
        "recovery-lock",
        "save-policy",
        "approve",
        "request-review",
        "append",
      ])
        await expect(versioningControl({ ...request, action })).rejects.toThrow("schreibgeschützt");
    } finally {
      registerReadOnlyResolver(previous);
    }
  }
});
