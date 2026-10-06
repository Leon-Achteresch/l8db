import { Database } from "bun:sqlite";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function createTestDatabase(output: string) {
  const path = resolve(output);
  const sql = await readFile(new URL("./IFC_SENDEN_POS.sql", import.meta.url), "utf8");
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, "wx");
  await file.close();
  const db = new Database(":memory:");
  try {
    db.query("ATTACH DATABASE ? AS EUROTIME").run(path);
    db.transaction(() => {
      db.run(`CREATE TABLE EUROTIME.IFC_SENDEN_POS (
        REF INTEGER PRIMARY KEY,
        REF_KOPF INTEGER NOT NULL,
        POS_NR INTEGER NOT NULL,
        EBENE INTEGER NOT NULL,
        SUBTAG TEXT,
        WERT_NAME TEXT NOT NULL,
        WERT_INHALT TEXT,
        WERT_ATTR TEXT,
        WERT_CLOB TEXT
      )`);
      db.run("CREATE INDEX EUROTIME.IFC_SENDEN_POS_DOCUMENT ON IFC_SENDEN_POS (REF_KOPF, POS_NR)");
      db.exec(sql);
    })();
    const result = db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM EUROTIME.IFC_SENDEN_POS")
      .get();
    return { path, rows: result?.count ?? 0 };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const result = await createTestDatabase(
    process.argv[2] ?? "test-artifacts/table-json-viewer.sqlite",
  );
  console.log(
    `${result.path}\n${result.rows} Zeilen · Tabelle IFC_SENDEN_POS · Filter REF_KOPF = 8292`,
  );
}
