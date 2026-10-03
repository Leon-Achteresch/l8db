import { SEQUENCE_PRIVS, TABLE_PRIVS } from "@/features/users/users-view/constants";
import type { TablePrivileges } from "@/lib/db";

export function privKey(tp: TablePrivileges, priv: string): boolean {
  switch (priv) {
    case "SELECT":
      return tp.select;
    case "INSERT":
      return tp.insert;
    case "UPDATE":
      return tp.update;
    case "DELETE":
      return tp.delete;
    case "TRUNCATE":
      return tp.truncate;
    case "REFERENCES":
      return tp.references;
    case "TRIGGER":
      return tp.trigger;
    default:
      return false;
  }
}

export function applicablePrivs(objectType: string): readonly string[] {
  return objectType === "sequence" ? SEQUENCE_PRIVS : TABLE_PRIVS;
}

export function allPrivsGranted(tp: TablePrivileges): boolean {
  return applicablePrivs(tp.object_type).every((priv) => privKey(tp, priv));
}
