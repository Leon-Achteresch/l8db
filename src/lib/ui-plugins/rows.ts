import type { Row } from "./api";

const frozen = new WeakMap<object, Row>();

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}

function copyValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    return undefined;
  }
}

export function freezeRow(row: Readonly<Record<string, unknown>>): Row {
  let copy = frozen.get(row);
  if (!copy) {
    const { __ctid__: _ctid, ...source } = row;
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(source)) data[key] = copyValue(source[key]);
    copy = Object.freeze(data);
    frozen.set(row, copy);
  }
  return copy;
}

export function freezeRows(rows: readonly Readonly<Record<string, unknown>>[]): readonly Row[] {
  return Object.freeze(rows.map(freezeRow));
}
