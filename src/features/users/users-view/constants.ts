import type { CreateFormState } from "@/features/users/users-view/types";

export const TABLE_PRIVS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

export const TABLE_PRIV_SHORT: Record<string, string> = {
  SELECT: "SEL",
  INSERT: "INS",
  UPDATE: "UPD",
  DELETE: "DEL",
  TRUNCATE: "TRU",
  REFERENCES: "REF",
  TRIGGER: "TRI",
};

export const SCHEMA_PRIVS = ["USAGE", "CREATE"] as const;

export const defaultCreateForm: CreateFormState = {
  name: "",
  password: "",
  superuser: false,
  can_login: true,
  create_db: false,
  create_role: false,
  replication: false,
  bypass_rls: false,
  conn_limit: "",
  valid_until: "",
  member_of: [],
};
