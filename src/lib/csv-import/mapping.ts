import type { CsvCell, CsvColumnMapping, CsvMappingIssues, ImportTargetColumn } from "./types";

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_\-.]/g, "")
    .trim();
}

export function isRequiredColumn(column: ImportTargetColumn): boolean {
  return !column.is_nullable && !column.has_default && !column.is_identity && !column.is_generated;
}

export function suggestMappings(
  headers: string[],
  targets: ImportTargetColumn[],
): CsvColumnMapping[] {
  const used = new Set<string>();
  return headers.map((header, csvIndex) => {
    const normalized = normalizeName(header);
    const match = targets.find(
      (t) => !t.is_generated && !used.has(t.name) && normalizeName(t.name) === normalized,
    );
    if (match) {
      used.add(match.name);
      return { csvIndex, target: match.name };
    }
    return { csvIndex, target: null };
  });
}

export function validateMappings(
  mappings: CsvColumnMapping[],
  targets: ImportTargetColumn[],
  rows: CsvCell[][],
): CsvMappingIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byName = new Map(targets.map((t) => [t.name, t]));

  const seen = new Map<string, number>();
  for (const mapping of mappings) {
    if (!mapping.target) continue;
    if (!byName.has(mapping.target)) {
      errors.push(`Unbekannte Zielspalte "${mapping.target}".`);
      continue;
    }
    seen.set(mapping.target, (seen.get(mapping.target) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) errors.push(`Zielspalte "${name}" ist mehrfach zugeordnet.`);
  }

  const mapped = new Set(seen.keys());
  if (mapped.size === 0) errors.push("Keine Spalte zugeordnet.");

  for (const target of targets) {
    if (mapped.has(target.name) && target.is_generated) {
      errors.push(`Generierte Spalte "${target.name}" kann nicht befüllt werden.`);
    }
    if (mapped.has(target.name) && target.is_identity) {
      warnings.push(`Identity-Spalte "${target.name}" wird mit CSV-Werten überschrieben.`);
    }
    if (!mapped.has(target.name) && isRequiredColumn(target)) {
      errors.push(`Pflichtspalte "${target.name}" ist nicht zugeordnet.`);
    }
    if (!mapped.has(target.name) && target.has_default && !target.is_identity) {
      warnings.push(`Spalte "${target.name}" verwendet den Default-Wert.`);
    }
  }

  for (const mapping of mappings) {
    const target = mapping.target ? byName.get(mapping.target) : undefined;
    if (!target || target.is_nullable) continue;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const value = rows[rowIndex]?.[mapping.csvIndex] ?? null;
      if (value === null) {
        errors.push(`Zeile ${rowIndex + 1}: Spalte "${target.name}" darf nicht NULL sein.`);
        break;
      }
    }
  }

  return { errors, warnings };
}

export interface CsvImportPayload {
  columns: string[];
  rows: CsvCell[][];
}

export function buildImportPayload(
  mappings: CsvColumnMapping[],
  rows: CsvCell[][],
): CsvImportPayload {
  const active = mappings.filter((m) => m.target !== null);
  return {
    columns: active.map((m) => m.target as string),
    rows: rows.map((row) => active.map((m) => row[m.csvIndex] ?? null)),
  };
}
