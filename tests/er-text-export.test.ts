import { describe, expect, test } from "bun:test";
import type { ERSchema } from "../src/lib/db/types";
import { mermaidIdentifier, toDbml, toMermaid } from "../src/lib/er-text-export";

const schema: ERSchema = {
  tables: [
    {
      schema: "public",
      name: "users",
      columns: [
        { name: "id", data_type: "integer", is_primary_key: true, is_nullable: false },
        {
          name: "e-mail",
          data_type: "character varying(255)",
          is_primary_key: false,
          is_nullable: true,
        },
      ],
    },
    {
      schema: "public",
      name: "orders",
      columns: [
        { name: "id", data_type: "bigint", is_primary_key: true, is_nullable: false },
        { name: "user_id", data_type: "integer", is_primary_key: false, is_nullable: true },
      ],
    },
    {
      schema: "public",
      name: "profiles",
      columns: [
        { name: "user_id", data_type: "integer", is_primary_key: true, is_nullable: false },
      ],
    },
    {
      schema: "public",
      name: "order lines",
      columns: [
        { name: "order_id", data_type: "bigint", is_primary_key: true, is_nullable: false },
        { name: "line", data_type: "int", is_primary_key: true, is_nullable: false },
      ],
    },
  ],
  foreign_keys: [
    {
      constraint_name: "orders_user_fk",
      from_schema: "public",
      from_table: "orders",
      from_column: "user_id",
      to_schema: "public",
      to_table: "users",
      to_column: "id",
    },
    {
      constraint_name: "profiles_user_fk",
      from_schema: "public",
      from_table: "profiles",
      from_column: "user_id",
      to_schema: "public",
      to_table: "users",
      to_column: "id",
    },
  ],
};

describe("toMermaid", () => {
  const output = toMermaid(schema);

  test("emits entities with sanitized names, types and key markers", () => {
    expect(output.startsWith("erDiagram\n")).toBe(true);
    expect(output).toContain("  users {\n    integer id PK\n");
    expect(output).toContain('    character_varying_255 e_mail "e-mail, nullable"');
    expect(output).toContain('    integer user_id FK "nullable"');
    expect(output).toContain("  order_lines {");
    expect(output).toContain("    integer user_id PK,FK");
  });

  test("derives cardinality from nullability and primary keys", () => {
    expect(output).toContain('  users |o--o{ orders : "orders_user_fk"');
    expect(output).toContain('  users ||--o| profiles : "profiles_user_fk"');
  });

  test("prefixes schemas when several are present", () => {
    const multi = toMermaid({
      tables: [
        { schema: "a", name: "t", columns: [] },
        { schema: "b", name: "t", columns: [] },
      ],
      foreign_keys: [],
    });
    expect(multi).toContain("  a_t {");
    expect(multi).toContain("  b_t {");
  });

  test("sanitizes identifiers", () => {
    expect(mermaidIdentifier("1st table")).toBe("_1st_table");
    expect(mermaidIdentifier("Café")).toBe("Cafe");
    expect(mermaidIdentifier("!!!")).toBe("_");
  });
});

describe("toDbml", () => {
  const output = toDbml(schema);

  test("emits tables, columns and settings", () => {
    expect(output).toContain('Table "public"."users" {\n  "id" integer [pk, not null]\n');
    expect(output).toContain('  "e-mail" "character varying(255)"\n');
    expect(output).toContain('  "user_id" integer\n');
  });

  test("uses an index block for composite primary keys", () => {
    expect(output).toContain('  indexes {\n    ("order_id", "line") [pk]\n  }');
  });

  test("emits references with cardinality", () => {
    expect(output).toContain(
      'Ref "orders_user_fk": "public"."orders"."user_id" > "public"."users"."id"',
    );
    expect(output).toContain(
      'Ref "profiles_user_fk": "public"."profiles"."user_id" - "public"."users"."id"',
    );
  });

  test("groups composite foreign keys", () => {
    const composite = toDbml({
      tables: [],
      foreign_keys: ["a", "b"].map((column) => ({
        constraint_name: "fk",
        from_schema: "s",
        from_table: "child",
        from_column: `p_${column}`,
        to_schema: "s",
        to_table: "parent",
        to_column: column,
      })),
    });
    expect(composite).toContain('Ref "fk": "s"."child".("p_a", "p_b") > "s"."parent".("a", "b")');
  });
});
