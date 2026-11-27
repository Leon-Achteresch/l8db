import { expect, test } from "bun:test";
import { defaultSchema } from "../src/lib/db-selection";
import { oracleLoginSchema } from "../src/lib/schema-selection";

test("Oracle customer connections start in their own login schema rather than another customer's first schema", () => {
  const schemas = ["L8DB_CUSTOMER_A", "L8DB_CUSTOMER_B", "L8DB_DEV"];
  expect(oracleLoginSchema("oracle://L8DB_CUSTOMER_B@localhost:1521/FREEPDB1", schemas)).toBe(
    "L8DB_CUSTOMER_B",
  );
  expect(oracleLoginSchema("oracle://l8db_dev@localhost:1521/FREEPDB1", schemas)).toBe("L8DB_DEV");
  expect(
    oracleLoginSchema("oracle://proxy%5BL8DB_CUSTOMER_A%5D@localhost:1521/FREEPDB1", schemas),
  ).toBe("L8DB_CUSTOMER_A");
  expect(oracleLoginSchema("oracle://missing@localhost:1521/FREEPDB1", schemas)).toBeNull();
});

test("Oracle catalog queries start in the login schema before the schema list has loaded", () => {
  const capabilities = { query_language: "sql", database_is_schema: false } as const;
  const connection = {
    kind: "oracle",
    connectionString: "oracle://l8db_dev@localhost:1521/FREEPDB1",
  } as const;
  expect(defaultSchema(connection, capabilities, "FREEPDB1", undefined, null)).toBe("L8DB_DEV");
  expect(defaultSchema(connection, capabilities, "FREEPDB1", ["L8DB_DEV", "OTHER"], null)).toBe(
    "L8DB_DEV",
  );
  expect(defaultSchema(connection, capabilities, "FREEPDB1", undefined, "OTHER")).toBe("OTHER");
  expect(
    defaultSchema({ ...connection, schemas: ["OTHER"] }, capabilities, "FREEPDB1", undefined, null),
  ).toBe("public");
  expect(
    defaultSchema(
      { kind: "oracle", connectionString: "oracle://proxy%5Bapp%5D@localhost:1521/FREEPDB1" },
      capabilities,
      "FREEPDB1",
      undefined,
      null,
    ),
  ).toBe("APP");
});
