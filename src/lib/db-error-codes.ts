import type { DatabaseKind } from "@/lib/db";

const CODE_PATTERNS: Record<DatabaseKind, Array<[RegExp, string, string]>> = {
  postgres: [
    [/\b28P01\b/i, "28P01", "Authentifizierung fehlgeschlagen"],
    [/\b23505\b/i, "23505", "Eindeutigkeitsverletzung"],
    [/\b23503\b/i, "23503", "Fremdschlüsselverletzung"],
    [/\b42601\b/i, "42601", "Syntaxfehler"],
    [/\b42501\b/i, "42501", "Berechtigung fehlt"],
    [/\b42P01\b/i, "42P01", "Tabelle oder Relation nicht gefunden"],
  ],
  mysql: [
    [/\b1045\b|ER_ACCESS_DENIED_ERROR/i, "1045", "Authentifizierung fehlgeschlagen"],
    [/\b1062\b|ER_DUP_ENTRY/i, "1062", "Eindeutigkeitsverletzung"],
    [/\b1451\b|ER_ROW_IS_REFERENCED/i, "1451", "Fremdschlüssel verhindert das Löschen"],
    [/\b1064\b|ER_PARSE_ERROR/i, "1064", "Syntaxfehler"],
    [/\b1142\b|ER_TABLEACCESS_DENIED_ERROR/i, "1142", "Berechtigung fehlt"],
    [/\b1146\b|ER_NO_SUCH_TABLE/i, "1146", "Tabelle nicht gefunden"],
  ],
  sqlite: [
    [
      /\bSQLITE_CONSTRAINT_UNIQUE\b|UNIQUE constraint failed/i,
      "SQLITE_CONSTRAINT_UNIQUE",
      "Eindeutigkeitsverletzung",
    ],
    [
      /\bSQLITE_CONSTRAINT_FOREIGNKEY\b|FOREIGN KEY constraint failed/i,
      "SQLITE_CONSTRAINT_FOREIGNKEY",
      "Fremdschlüsselverletzung",
    ],
    [/\bSQLITE_ERROR\b|near ".*": syntax error/i, "SQLITE_ERROR", "SQL-Fehler oder Syntaxfehler"],
  ],
  mssql: [
    [/\b18456\b/i, "18456", "Authentifizierung fehlgeschlagen"],
    [/\b2627\b|\b2601\b/i, "2627/2601", "Eindeutigkeitsverletzung"],
    [/\b547\b/i, "547", "Fremdschlüsselverletzung"],
    [/\b102\b/i, "102", "Syntaxfehler"],
    [/\b229\b/i, "229", "Berechtigung fehlt"],
    [/\b208\b/i, "208", "Objekt nicht gefunden"],
  ],
  clickhouse: [
    [/Code:\s*516\b/i, "516", "Authentifizierung fehlgeschlagen"],
    [/Code:\s*57\b/i, "57", "Tabelle oder Datenbank nicht gefunden"],
    [/Code:\s*62\b/i, "62", "Syntaxfehler"],
    [/Code:\s*497\b/i, "497", "Berechtigung fehlt"],
  ],
  mongodb: [
    [/\b11000\b|E11000/i, "11000", "Eindeutigkeitsverletzung"],
    [/\b13\b.*Unauthorized|Unauthorized/i, "13", "Berechtigung fehlt"],
    [/\b18\b.*Authentication/i, "18", "Authentifizierung fehlgeschlagen"],
  ],
  redis: [
    [/NOAUTH|WRONGPASS/i, "NOAUTH/WRONGPASS", "Authentifizierung fehlgeschlagen"],
    [/NOPERM/i, "NOPERM", "Berechtigung fehlt"],
    [/WRONGTYPE/i, "WRONGTYPE", "Falscher Datentyp für den Befehl"],
  ],
  oracle: [
    [/ORA-01017/i, "ORA-01017", "Authentifizierung fehlgeschlagen"],
    [/ORA-00001/i, "ORA-00001", "Eindeutigkeitsverletzung"],
    [/ORA-02291|ORA-02292/i, "ORA-02291/02292", "Fremdschlüsselverletzung"],
    [
      /ORA-00933|ORA-00904|ORA-00900/i,
      "ORA-00933/00904/00900",
      "SQL-Syntax oder Bezeichner ungültig",
    ],
    [/ORA-01031/i, "ORA-01031", "Berechtigung fehlt"],
  ],
  cassandra: [
    [/Unauthorized|\bcode\s*=\s*210/i, "210", "Berechtigung fehlt"],
    [/AlreadyExists/i, "AlreadyExists", "Objekt existiert bereits"],
    [/\bSyntaxException\b/i, "SyntaxException", "Syntaxfehler"],
  ],
  duckdb: [
    [/Constraint Error.*UNIQUE|Duplicate key/i, "CONSTRAINT", "Eindeutigkeitsverletzung"],
    [/Constraint Error.*FOREIGN KEY/i, "CONSTRAINT", "Fremdschlüsselverletzung"],
    [/Parser Error/i, "PARSER", "Syntaxfehler"],
    [/Catalog Error/i, "CATALOG", "Objekt nicht gefunden"],
  ],
  odbc: [
    [/\b28000\b/i, "28000", "Authentifizierung fehlgeschlagen"],
    [/\b23000\b/i, "23000", "Integritäts- oder Eindeutigkeitsverletzung"],
    [/\b42000\b/i, "42000", "Syntaxfehler oder Berechtigung fehlt"],
    [/\b42S02\b/i, "42S02", "Tabelle oder View nicht gefunden"],
  ],
};

export function dbErrorCode(
  kind: DatabaseKind | undefined,
  message: string,
): { code: string; description: string } | null {
  if (!kind) return null;
  const match = CODE_PATTERNS[kind]?.find(([pattern]) => pattern.test(message));
  return match ? { code: match[1], description: match[2] } : null;
}
