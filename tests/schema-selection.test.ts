import { expect, test } from "bun:test";
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
