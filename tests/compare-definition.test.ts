import { describe, expect, test } from "bun:test";

import { formatSequenceDefinition, formatTableDefinition } from "../src/lib/compare-definition";

describe("formatTableDefinition", () => {
  test("sortiert Spalten und hängt Constraints, Indizes und Trigger an", () => {
    const text = formatTableDefinition({
      schema: "public",
      table: "orders",
      columns: [
        {
          name: "amount",
          data_type: "numeric",
          is_nullable: false,
          column_default: "0",
          is_primary_key: false,
          ordinal_position: 2,
          character_maximum_length: null,
        },
        {
          name: "id",
          data_type: "integer",
          is_nullable: false,
          column_default: null,
          is_primary_key: true,
          ordinal_position: 1,
          character_maximum_length: null,
        },
      ],
      constraints: [
        {
          name: "orders_amount_check",
          constraint_type: "CHECK",
          columns: ["amount"],
          definition: "amount >= 0",
        },
      ],
      indexes: [
        {
          name: "orders_pkey",
          is_unique: true,
          is_primary: true,
          columns: ["id"],
          index_type: "btree",
          definition: "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
        },
      ],
      triggers: [
        {
          trigger_name: "orders_audit",
          table_schema: "public",
          table_name: "orders",
          event: "UPDATE",
          timing: "AFTER",
          orientation: "ROW",
          function_schema: "public",
          function_name: "audit",
          enabled: "O",
          definition: "CREATE TRIGGER orders_audit AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION audit()",
        },
      ],
    });
    expect(text).toContain("TABLE public.orders");
    expect(text.indexOf("id integer")).toBeLessThan(text.indexOf("amount numeric"));
    expect(text).toContain("CONSTRAINTS");
    expect(text).toContain("orders_amount_check");
    expect(text).toContain("INDEXES");
    expect(text).toContain("orders_pkey");
    expect(text).toContain("TRIGGERS");
    expect(text).toContain("orders_audit");
  });
});

describe("formatSequenceDefinition", () => {
  test("schreibt die Sequenzfelder zeilenweise", () => {
    const text = formatSequenceDefinition({
      schema: "public",
      name: "orders_id_seq",
      data_type: "bigint",
      start_value: "1",
      min_value: "1",
      max_value: "9223372036854775807",
      increment_by: "1",
      cycle: false,
      last_value: "12",
    });
    expect(text).toBe(
      [
        "SEQUENCE public.orders_id_seq",
        "  data_type bigint",
        "  start 1",
        "  min 1",
        "  max 9223372036854775807",
        "  increment 1",
        "  cycle NO",
      ].join("\n"),
    );
  });
});
