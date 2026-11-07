import { describe, expect, test } from "bun:test";
import { oracleLoginSchema } from "../src/lib/schema-selection";
import { defaultTargetSchema } from "../src/lib/transfer/default-target";

const SCHEMAS = ["APP_OWNER", "HR", "MixedCase", "SCHEMA1", "SCHEMA2", "SYSTEM"];

describe("defaultTargetSchema", () => {
  test("maps the own schema of a restricted source user to the own schema of the target user", () => {
    expect(defaultTargetSchema("SCHEMA1", "SCHEMA1", "SCHEMA2", false)).toBe("SCHEMA2");
    expect(defaultTargetSchema("HR", "SCHEMA1", "SCHEMA2", false)).toBe("HR");
    expect(defaultTargetSchema("SCHEMA1", "SCHEMA1", "SCHEMA1", false)).toBe("SCHEMA1");
  });

  test("keeps the source name when the target may write every schema or is not Oracle", () => {
    expect(defaultTargetSchema("HR", "HR", "SYSTEM", true)).toBe("HR");
    expect(defaultTargetSchema("public", null, null, false)).toBe("public");
  });

  test("resolves the login schema from URL, proxy, sysdba and quoted users", () => {
    expect(oracleLoginSchema("oracle://schema1@testserver:1521/FREEPDB1", SCHEMAS)).toBe("SCHEMA1");
    expect(oracleLoginSchema("oracle://admin[app_owner]@h:1521/S", SCHEMAS)).toBe("APP_OWNER");
    expect(oracleLoginSchema("oracle://system%20as%20sysdba@h:1521/S", SCHEMAS)).toBe("SYSTEM");
    expect(oracleLoginSchema("oracle://MixedCase@h:1521/S", SCHEMAS)).toBe("MixedCase");
    expect(oracleLoginSchema("oracle://@h:1521/S", SCHEMAS)).toBeNull();
  });
});
