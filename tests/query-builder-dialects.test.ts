import { describe, expect, test } from "bun:test";

const { buildSelectSql, emptyBuilderState } = await import("../src/lib/query-builder");

type State = ReturnType<typeof emptyBuilderState>;

function state(kind: State["kind"], patch: Partial<State> = {}): State {
  return {
    ...emptyBuilderState(kind),
    schema: "app",
    table: "users",
    columns: ["id"],
    limit: 25,
    ...patch,
  };
}

const join = {
  constraintName: "fk",
  type: "LEFT" as const,
  schema: "app",
  table: "teams",
  fromColumn: "team_id",
  toColumn: "id",
  columns: ["name"],
};

describe("buildSelectSql dialects", () => {
  test("SQL Server uses TOP instead of LIMIT", () => {
    expect(buildSelectSql(state("mssql"))).toBe("SELECT TOP (25) [id]\nFROM [app].[users];");
    expect(
      buildSelectSql(
        state("mssql", {
          orders: [{ id: "o", source: "base", column: "id", direction: "DESC" }],
        }),
      ),
    ).toBe("SELECT TOP (25) [id]\nFROM [app].[users]\nORDER BY [id] DESC;");
  });

  test("SQL Server keeps AS table aliases and TOP with joins", () => {
    expect(buildSelectSql(state("mssql", { join }))).toBe(
      "SELECT TOP (25) t1.[id], t2.[name] AS [teams_name]\n" +
        "FROM [app].[users] AS t1\n" +
        "LEFT JOIN [app].[teams] AS t2 ON t2.[id] = t1.[team_id];",
    );
  });

  test("Oracle uses FETCH FIRST and no AS before table aliases", () => {
    expect(buildSelectSql(state("oracle"))).toBe(
      'SELECT "id"\nFROM "app"."users"\nFETCH FIRST 25 ROWS ONLY;',
    );
    expect(buildSelectSql(state("oracle", { join }))).toBe(
      'SELECT t1."id", t2."name" AS "teams_name"\n' +
        'FROM "app"."users" t1\n' +
        'LEFT JOIN "app"."teams" t2 ON t2."id" = t1."team_id"\n' +
        "FETCH FIRST 25 ROWS ONLY;",
    );
  });

  test("SQL Server and Oracle omit the row limit when none is set", () => {
    expect(buildSelectSql(state("mssql", { limit: null }))).toBe(
      "SELECT [id]\nFROM [app].[users];",
    );
    expect(buildSelectSql(state("oracle", { limit: null }))).toBe(
      'SELECT "id"\nFROM "app"."users";',
    );
  });

  test("other dialects keep LIMIT and AS aliases", () => {
    expect(buildSelectSql(state("postgres"))).toBe('SELECT "id"\nFROM "app"."users"\nLIMIT 25;');
    expect(buildSelectSql(state("mysql", { join }))).toBe(
      "SELECT t1.`id`, t2.`name` AS `teams_name`\n" +
        "FROM `app`.`users` AS t1\n" +
        "LEFT JOIN `app`.`teams` AS t2 ON t2.`id` = t1.`team_id`\n" +
        "LIMIT 25;",
    );
  });
});
