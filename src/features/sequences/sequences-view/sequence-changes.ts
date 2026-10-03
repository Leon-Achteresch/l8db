import type { AlterSequenceRequest, DatabaseKind, SequenceInfo } from "@/lib/db";

export function canEditSequences(kind: DatabaseKind | undefined): boolean {
  return kind === "postgres";
}

const INTEGER = /^[+-]?\d+$/;

function integer(label: string, value: string, optional: boolean): string {
  const text = value.trim();
  if (optional && text === "") return "";
  if (!INTEGER.test(text)) throw new Error(`${label} muss eine ganze Zahl sein: ${value}`);
  return text;
}

export function sequenceChanges(
  sequence: SequenceInfo,
  form: AlterSequenceRequest,
): AlterSequenceRequest {
  const changes: AlterSequenceRequest = {};
  if (form.increment_by !== undefined && form.increment_by !== sequence.increment_by)
    changes.increment_by = integer("Inkrement", form.increment_by, false);
  if (form.min_value !== undefined && form.min_value !== sequence.min_value)
    changes.min_value = integer("Minimalwert", form.min_value, true);
  if (form.max_value !== undefined && form.max_value !== sequence.max_value)
    changes.max_value = integer("Maximalwert", form.max_value, true);
  if (form.cycle !== undefined && form.cycle !== sequence.cycle) changes.cycle = form.cycle;
  if (form.restart_with !== undefined && form.restart_with.trim() !== "")
    changes.restart_with = integer("Neu starten mit", form.restart_with, false);
  return changes;
}
