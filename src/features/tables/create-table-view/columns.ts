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

const SIZED_TYPE = /^(.*?)\s*\((\d+(?:\s*,\s*\d+)?)\)$/;

export function splitType(dataType: string): { base: string; length: string } {
  const match = SIZED_TYPE.exec(dataType.trim());
  if (!match) return { base: dataType, length: "" };
  return { base: match[1], length: match[2] };
}

export function joinType(base: string, length: string): string {
  const size = length.trim();
  return size ? `${base}(${size})` : base;
}
