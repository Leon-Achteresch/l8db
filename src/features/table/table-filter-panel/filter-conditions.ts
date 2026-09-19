import type { FilterCondition as Condition } from "@/lib/table-view-state";

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function emptyCondition(column = ""): Condition {
  return { id: createId(), column, operator: "eq", value: "" };
}
