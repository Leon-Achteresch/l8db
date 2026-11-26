import { expect, test } from "bun:test";
import { sqlImportSummary } from "@/features/import/sql-import-summary";

test("previews only executable SQL and SQL*Plus commands in the selected file", () => {
  expect(sqlImportSummary(null, "oracle")).toBeNull();
  for (const source of ["", " -- leer\n", "REM Ein Hinweis\nREMARK Noch ein Hinweis"])
    expect(sqlImportSummary(source, "oracle")).toEqual({
      label: "0 Anweisungen",
      hasCommands: false,
      runnable: false,
      unterminated: false,
    });
  expect(sqlImportSummary("PROMPT Start\n@weiter.sql", "oracle")?.label).toBe("2 SQL*Plus-Befehle");
  const block = "BEGIN\n  NULL;\n  NULL;\nEND;\n/\n";
  expect(sqlImportSummary(block, "oracle")?.label).toBe("1 Anweisung");
  expect(sqlImportSummary(`${block}/\nPROMPT Fertig`, "oracle")).toEqual({
    label: "1 Anweisung · 2 SQL*Plus-Befehle",
    hasCommands: true,
    runnable: true,
    unterminated: false,
  });
  expect(sqlImportSummary("PROMPT Start\nselect 'offen", "oracle")).toMatchObject({
    runnable: false,
    unterminated: true,
  });
  expect(sqlImportSummary("SELECT $$a;b$$; SELECT 2;", "postgres")?.label).toBe("2 Anweisungen");
  expect(sqlImportSummary("SELECT 1\nGO 3\n", "mssql")?.label).toBe("3 Anweisungen");
});
