import type { ColumnDefinition } from "@/lib/db";

export type FormColumn = ColumnDefinition & { id: number };

export function nextId() {
  return Date.now() + Math.random();
}

export function templateType(dataType: string, maxLength: number | null): string {
  if (maxLength === null || dataType.includes("(")) return dataType;
  return `${dataType}(${maxLength})`;
}

export function emptyColumn(): ColumnDefinition & { id: number } {
  return {
    id: Date.now() + Math.random(),
    name: "",
    data_type: "text",
    is_nullable: true,
    default_value: null,
    is_primary_key: false,
    is_unique: false,
  };
}
