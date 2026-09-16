import { describe, expect, it } from "bun:test";
import { dependencyRoute } from "@/lib/used-by";

const dep = (object_type: string) => ({
  owner: "DEV_ACHTERESCH",
  name: "PA_VERLADUNG",
  object_type,
  status: "VALID",
  relation: "used_by",
  detail: "",
  oid: "",
});

describe("dependencyRoute packages", () => {
  it("maps package to spec", () => {
    expect(dependencyRoute(dep("package"))).toEqual({
      kind: "package",
      schema: "DEV_ACHTERESCH",
      name: "PA_VERLADUNG",
      part: "spec",
    });
  });

  it("maps package body to body", () => {
    expect(dependencyRoute(dep("package body"))?.kind).toBe("package");
    expect(dependencyRoute(dep("package body"))).toMatchObject({ part: "body" });
  });
});
