export type DuplicateColumnMeta = {
  name: string;
  is_primary_key?: boolean;
  column_default?: string | null;
  is_identity?: boolean;
  is_generated?: boolean;
};

export type DuplicateFieldMode = "default" | "null" | "value";

export type DuplicateField = {
  mode: DuplicateFieldMode;
  value: string;
  isPrimaryKey: boolean;
  cleared: boolean;
};

export type DuplicatePrefill = Record<string, DuplicateField>;

const CTID_COLUMN = "__ctid__";

const GENERATED_DEFAULT_PATTERN = /generated\s+always\s+as/i;

function isGenerated(meta: DuplicateColumnMeta | undefined): boolean {
  if (!meta) return false;
  if (meta.is_generated) return true;
  return !!meta.column_default && GENERATED_DEFAULT_PATTERN.test(meta.column_default);
}

function isAutoValue(meta: DuplicateColumnMeta | undefined): boolean {
  if (!meta) return false;
  if (meta.is_identity) return true;
  return meta.column_default !== null && meta.column_default !== undefined;
}

export function buildDuplicatePrefill(
  columns: string[],
  row: Record<string, unknown>,
  columnDetails?: DuplicateColumnMeta[],
): DuplicatePrefill {
  const metaByName = new Map<string, DuplicateColumnMeta>();
  for (const meta of columnDetails ?? []) {
    metaByName.set(meta.name, meta);
  }

  const prefill: DuplicatePrefill = {};
  for (const column of columns) {
    if (column === CTID_COLUMN) continue;
    const meta = metaByName.get(column);
    if (isGenerated(meta)) continue;

    const isPrimaryKey = !!meta?.is_primary_key;

    if (isAutoValue(meta)) {
      prefill[column] = { mode: "default", value: "", isPrimaryKey, cleared: true };
      continue;
    }

    const raw = row[column];
    if (raw === null || raw === undefined) {
      prefill[column] = { mode: "null", value: "", isPrimaryKey, cleared: false };
      continue;
    }

    prefill[column] = {
      mode: "value",
      value: typeof raw === "string" ? raw : String(raw),
      isPrimaryKey,
      cleared: false,
    };
  }
  return prefill;
}

const CONFLICT_PATTERNS = [
  /duplicate key value violates unique constraint/i,
  /unique constraint failed/i,
  /duplicate entry/i,
  /violation of (primary key|unique key) constraint/i,
  /\bORA-00001\b/i,
  /\b23505\b/,
];

export function describeInsertError(error: unknown): string {
  const message = typeof error === "string" ? error : ((error as Error)?.message ?? String(error));
  if (CONFLICT_PATTERNS.some((pattern) => pattern.test(message))) {
    return `Konflikt: Ein Datensatz mit diesen Schlüsselwerten existiert bereits. Bitte Primärschlüssel oder eindeutige Spalten anpassen.\n${message}`;
  }
  return message;
}
