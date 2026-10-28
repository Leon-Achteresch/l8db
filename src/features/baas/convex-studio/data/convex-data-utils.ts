import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ConvexDocument,
  ConvexFieldValidator,
  ConvexFilterClause,
  ConvexFilterExpression,
  ConvexFilterOp,
  ConvexIndex,
  ConvexSchemaTable,
  ConvexValidator,
} from "@/lib/db/convex-studio-data";
import type { ConvexStudioDeployment } from "../convex-studio-sections";

export const PAGE_SIZE = 50;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export const dataKey = (deployment: ConvexStudioDeployment) => [
  "convex",
  deployment.profileId,
  deployment.projectId,
  deployment.deploymentName,
  "studio-data",
];

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{31,37}$/;

export function isConvexId(value: unknown): value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return false;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    buffer = ((buffer << 5) | ID_ALPHABET.indexOf(character)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  const varint = bytes.findIndex((byte) => byte < 0x80);
  if (varint < 0 || varint > 4 || bytes.length !== varint + 19) return false;
  let sum = 0;
  let check = 0;
  for (const byte of bytes.slice(0, -2)) {
    sum = (sum + byte) & 0xff;
    check = (check + sum) & 0xff;
  }
  return bytes.at(-2) === sum && bytes.at(-1) === check;
}

export type UiFilterOp = ConvexFilterOp | "defined" | "undefined";

export const FILTER_OPS: { value: UiFilterOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "type", label: "ist Typ" },
  { value: "notype", label: "ist nicht Typ" },
  { value: "defined", label: "ist definiert" },
  { value: "undefined", label: "fehlt" },
];

export const VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "null",
  "array",
  "object",
  "id",
  "bytes",
  "bigint",
];

export interface FilterDraft {
  key: string;
  field: string;
  op: UiFilterOp;
  value: string;
}

export function parseJsonValue(text: string, label: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${label}: Wert fehlt.`);
  try {
    return JSON.parse(trimmed);
  } catch {
    if (/^[\p{L}\p{N}_ .@:/-]+$/u.test(trimmed)) return trimmed;
    throw new Error(`${label}: Ungültiges JSON.`);
  }
}

export function draftToClause(draft: FilterDraft, index: number): ConvexFilterClause {
  const field = draft.field.trim();
  if (!field) throw new Error(`Filter ${index + 1}: Feld fehlt.`);
  const base = { id: String(index), field, enabled: true };
  if (draft.op === "defined") return { ...base, op: "notype", value: "unset" };
  if (draft.op === "undefined") return { ...base, op: "type", value: "unset" };
  if (draft.op === "type" || draft.op === "notype") {
    return { ...base, op: draft.op, value: draft.value || "string" };
  }
  return { ...base, op: draft.op, value: parseJsonValue(draft.value, `Filter ${index + 1}`) };
}

export function tableIndexes(indexes: ConvexIndex[], table: string) {
  const own = indexes.filter((index) => index.table === table);
  return {
    database: own.flatMap((index) =>
      Array.isArray(index.fields) ? [{ name: index.name, fields: index.fields }] : [],
    ),
    search: own.flatMap((index) =>
      !Array.isArray(index.fields) && "searchField" in index.fields
        ? [{ name: index.name, ...index.fields }]
        : [],
    ),
    vector: own.flatMap((index) =>
      !Array.isArray(index.fields) && "vectorField" in index.fields
        ? [{ name: index.name, ...index.fields }]
        : [],
    ),
    all: own,
  };
}

export function schemaFields(table: ConvexSchemaTable | undefined) {
  const type = table?.documentType;
  if (type?.type !== "object" || !type.value || typeof type.value !== "object") return null;
  return type.value as Record<string, ConvexFieldValidator>;
}

export function documentColumns(
  documents: ConvexDocument[],
  schema: ConvexSchemaTable | undefined,
) {
  const names = new Set<string>(["_id"]);
  for (const name of Object.keys(schemaFields(schema) ?? {})) names.add(name);
  for (const document of documents) {
    for (const name of Object.keys(document)) {
      if (name !== "_creationTime") names.add(name);
    }
  }
  names.add("_creationTime");
  return [...names];
}

export function validatorText(validator: ConvexValidator | null | undefined): string {
  if (!validator) return "any";
  const value = validator.value as unknown;
  switch (validator.type) {
    case "id":
      return `Id<"${validator.tableName ?? "?"}">`;
    case "array":
      return `${validatorText(value as ConvexValidator)}[]`;
    case "union":
      return Array.isArray(value)
        ? value.map((item) => validatorText(item as ConvexValidator)).join(" | ")
        : "union";
    case "literal":
      return JSON.stringify(value);
    case "object": {
      if (!value || typeof value !== "object") return "object";
      const fields = Object.entries(value as Record<string, ConvexFieldValidator>).map(
        ([key, field]) => `${key}${field.optional ? "?" : ""}: ${validatorText(field.fieldType)}`,
      );
      return `{ ${fields.join("; ")} }`;
    }
    case "record": {
      const record = validator as unknown as {
        keys?: ConvexValidator;
        values?: { fieldType?: ConvexValidator };
      };
      return `Record<${validatorText(record.keys)}, ${validatorText(record.values?.fieldType)}>`;
    }
    case "float64":
      return "number";
    default:
      return validator.type;
  }
}

export function cellPreview(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatCreationTime(value: unknown): string {
  return typeof value === "number" ? new Date(value).toLocaleString("de-DE") : "";
}

export function idReferences(document: ConvexDocument, limit = 50) {
  const found: { path: string; id: string }[] = [];
  const visit = (value: unknown, path: string) => {
    if (found.length >= limit) return;
    if (isConvexId(value)) {
      if (path !== "_id") found.push({ path, id: value });
    } else if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) visit(item, `${path}[${index}]`);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) visit(item, path ? `${path}.${key}` : key);
    }
  };
  visit(document, "");
  return found;
}

export function withoutSystemFields(document: Record<string, unknown>) {
  const { _id, _creationTime, ...rest } = document;
  return rest;
}

export function parseDocuments(text: string, allowArray: boolean): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Ungültiges JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const items = Array.isArray(parsed) && allowArray ? parsed : [parsed];
  if (items.length === 0) throw new Error("Mindestens ein Dokument angeben.");
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        allowArray
          ? "Ein Dokument muss ein JSON-Objekt sein (oder ein Array von Objekten)."
          : "Ein Dokument muss ein JSON-Objekt sein.",
      );
    }
    const reserved = Object.keys(item).find(
      (key) => key.startsWith("_") && key !== "_id" && key !== "_creationTime",
    );
    if (reserved) throw new Error(`Feldnamen mit _ am Anfang sind reserviert: ${reserved}`);
  }
  return items as Record<string, unknown>[];
}

export function documentsText(documents: ConvexDocument[], format: "json" | "jsonl") {
  return format === "json"
    ? JSON.stringify(documents, null, 2)
    : documents.map((document) => JSON.stringify(document)).join("\n");
}

export async function saveDocuments(
  table: string,
  format: "json" | "jsonl",
  documents: ConvexDocument[],
): Promise<boolean> {
  const path = await save({
    defaultPath: `${table}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return false;
  await writeTextFile(path, documentsText(documents, format));
  return true;
}

export interface FilterState {
  clauses: FilterDraft[];
  mode: "none" | "index" | "search";
  indexName: string;
  indexValues: string[];
  search: string;
  searchValues: string[];
}

export const EMPTY_FILTER: FilterState = {
  clauses: [],
  mode: "none",
  indexName: "",
  indexValues: [],
  search: "",
  searchValues: [],
};

export const activeFilterCount = (state: FilterState) =>
  state.clauses.length + (state.mode === "none" ? 0 : 1);

export function compileFilter(
  state: FilterState,
  indexes: ConvexIndex[],
  table: string,
  order: "asc" | "desc",
): ConvexFilterExpression | null {
  const clauses = state.clauses.map(draftToClause);
  const { database, search } = tableIndexes(indexes, table);
  if (state.mode === "index") {
    const index = database.find((item) => item.name === state.indexName);
    if (!index) throw new Error("Index auswählen.");
    const fields = index.fields.filter((field) => field !== "_creationTime");
    let gap = false;
    const indexClauses = fields.map((field, position) => {
      const text = state.indexValues[position]?.trim() ?? "";
      if (!text) {
        gap = true;
        return { type: "indexEq" as const, enabled: false, value: null };
      }
      if (gap) throw new Error("Indexwerte müssen von vorne lückenlos gesetzt sein.");
      return { type: "indexEq" as const, enabled: true, value: parseJsonValue(text, field) };
    });
    return { clauses, order, index: { name: index.name, clauses: indexClauses } };
  }
  if (state.mode === "search") {
    const index = search.find((item) => item.name === state.indexName);
    if (!index) throw new Error("Suchindex auswählen.");
    if (!state.search.trim()) throw new Error("Suchbegriff eingeben.");
    return {
      clauses,
      order: "asc",
      index: {
        name: index.name,
        search: state.search.trim(),
        clauses: index.filterFields.map((field, position) => {
          const text = state.searchValues[position]?.trim() ?? "";
          return {
            field,
            enabled: text !== "",
            value: text ? parseJsonValue(text, field) : null,
          };
        }),
      },
    };
  }
  return clauses.length || order === "asc" ? { clauses, order } : null;
}
