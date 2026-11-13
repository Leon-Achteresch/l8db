const ROUTINE = ["EXECUTE", "DEBUG"];

export const OBJECT_PRIVILEGES: Record<string, string[]> = {
  TABLE: [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "READ",
    "ALTER",
    "INDEX",
    "REFERENCES",
    "DEBUG",
    "FLASHBACK",
  ],
  VIEW: ["SELECT", "INSERT", "UPDATE", "DELETE", "READ", "REFERENCES", "DEBUG", "FLASHBACK"],
  SEQUENCE: ["SELECT", "ALTER"],
  PROCEDURE: ROUTINE,
  FUNCTION: ROUTINE,
  PACKAGE: ROUTINE,
  TYPE: ["EXECUTE", "DEBUG", "UNDER"],
  DIRECTORY: ["READ", "WRITE", "EXECUTE"],
};

export const MAX_GRANT_ROWS = 300;
