import { describe, expect, test } from "bun:test";
import {
  appendLogLines,
  backupToolFor,
  defaultBackupFileName,
  defaultBackupOptions,
  formatBytes,
  isPlainSqlRestore,
  parseNameList,
  plainSqlRestoreOptions,
  progressPercent,
  restoreBlockReason,
  restoreConfirmationPhrase,
  restoreEffects,
  supportsRestore,
} from "../src/lib/backup";

describe("backup helpers", () => {
  test("defaults follow the database family", () => {
    expect(defaultBackupOptions("postgres", "backup")).toMatchObject({ format: "custom", jobs: 4 });
    expect(defaultBackupOptions("mysql", "backup")).toMatchObject({
      format: "sql",
      singleTransaction: true,
      routines: true,
      triggers: true,
    });
    expect(defaultBackupOptions("mongodb", "backup")).toMatchObject({ gzip: true });
    expect(defaultBackupOptions("mssql", "backup")).toMatchObject({ copyOnly: true });
    expect(defaultBackupOptions("postgres", "restore")).toMatchObject({ exitOnError: true });
  });

  test("file names carry database, timestamp and extension", () => {
    const now = new Date(2026, 8, 24, 9, 5);
    expect(
      defaultBackupFileName("postgres", { format: "custom", gzip: false }, "shop db", now),
    ).toBe("shop-db-2026-09-24-0905.dump");
    expect(
      defaultBackupFileName("postgres", { format: "directory", gzip: false }, "shop", now),
    ).toBe("shop-2026-09-24-0905");
    expect(defaultBackupFileName("postgres", { format: "globals", gzip: false }, "shop", now)).toBe(
      "shop-globals-2026-09-24-0905.sql",
    );
    expect(defaultBackupFileName("mongodb", { format: "archive", gzip: true }, "app", now)).toBe(
      "app-2026-09-24-0905.archive.gz",
    );
  });

  test("tools and restore support per family", () => {
    expect(backupToolFor("postgres", "globals")).toBe("pg_dumpall");
    expect(backupToolFor("postgres", "custom")).toBe("pg_dump");
    expect(backupToolFor("sqlite", "sqlite")).toBeNull();
    expect(supportsRestore("redis")).toBe(false);
    expect(supportsRestore("mssql")).toBe(true);
    expect(supportsRestore("oracle")).toBe(false);
  });

  test("restore is blocked for read-only connections and unsupported kinds", () => {
    expect(restoreBlockReason({ kind: "postgres", readOnly: true }, { backup: true })).toContain(
      "Lesemodus",
    );
    expect(restoreBlockReason({ kind: "redis" }, { backup: true })).toContain("nicht unterstützt");
    expect(restoreBlockReason({ kind: "postgres" }, { backup: false })).toContain(
      "nicht unterstützt",
    );
    expect(restoreBlockReason({ kind: "postgres" }, { backup: true })).toBeNull();
    expect(restoreBlockReason(null, { backup: true })).toBe("Keine Verbindung aktiv.");
  });

  test("confirmation phrase is the target database", () => {
    expect(restoreConfirmationPhrase("shop", "Prod")).toBe("shop");
    expect(restoreConfirmationPhrase(null, "Prod")).toBe("Prod");
    expect(
      restoreEffects("mssql", {
        ...defaultBackupOptions("mssql", "restore"),
        replace: true,
        closeConnections: true,
      }),
    ).toHaveLength(2);
    expect(restoreEffects("sqlite", defaultBackupOptions("sqlite", "restore"))).toHaveLength(1);
  });

  test("small formatting helpers", () => {
    expect(parseNameList("public, sales\n audit ,,")).toEqual(["public", "sales", "audit"]);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(null)).toBe("–");
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(5, 0)).toBeNull();
    expect(appendLogLines(["a", "b"], ["c", "d"], 3)).toEqual(["b", "c", "d"]);
  });
});

describe("PostgreSQL-Wiederherstellung: Optionen passend zum Werkzeug", () => {
  test("SQL-Dateien verwerfen pg_restore-Optionen und behaupten kein --clean", () => {
    const options = { ...defaultBackupOptions("postgres", "restore"), clean: true, jobs: 4 };
    expect(isPlainSqlRestore("postgres", " /tmp/app.SQL ")).toBe(true);
    expect(isPlainSqlRestore("postgres", "/tmp/app.dump")).toBe(false);
    expect(restoreEffects("postgres", plainSqlRestoreOptions(options))).toEqual([]);
    expect(plainSqlRestoreOptions(options).jobs).toBeNull();
  });
  test("--clean wird mit Nur Daten nicht angekündigt", () => {
    const options = { ...defaultBackupOptions("postgres", "restore"), clean: true };
    expect(restoreEffects("postgres", { ...options, content: "data" })).toEqual([]);
    expect(restoreEffects("postgres", options)).toHaveLength(1);
  });
});
