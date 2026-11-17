import type { CsvColumnMapping, ImportTargetColumn } from "@/lib/csv-import";
import type { CsvCheckReport, CsvCheckRequest, ImportFileSource } from "@/lib/db";

export function csvFileCheckRequest(
  source: ImportFileSource,
  width: number,
  mappings: CsvColumnMapping[],
  targets: ImportTargetColumn[],
): CsvCheckRequest | null {
  if (source.format !== "csv" || width < 1) return null;
  const byName = new Map(targets.map((target) => [target.name, target]));
  const names = new Set<string>();
  const columns: CsvCheckRequest["columns"] = [];
  for (const mapping of mappings) {
    if (mapping.target === null) continue;
    const target = byName.get(mapping.target);
    if (
      !target ||
      target.is_generated ||
      names.has(target.name) ||
      !Number.isInteger(mapping.csvIndex) ||
      mapping.csvIndex < 0 ||
      mapping.csvIndex >= width
    )
      return null;
    names.add(target.name);
    columns.push({ index: mapping.csvIndex, name: target.name, nullable: target.is_nullable });
  }
  return columns.length ? { source, expected_columns: width, columns } : null;
}

export interface CsvCheckState {
  checkedRows: number | null;
  checking: boolean;
  cancelling: boolean;
  cancelled: boolean;
  report: CsvCheckReport | null;
  error: string | null;
}

const IDLE: CsvCheckState = {
  checkedRows: null,
  checking: false,
  cancelling: false,
  cancelled: false,
  report: null,
  error: null,
};

export interface CsvCheckEvents {
  onProgress: (rows: number) => void;
  onCancelRequested: () => void;
}

export function csvCheckBlockedReason(check: CsvCheckState): string | null {
  if (check.checking) return "Dateiprüfung läuft";
  if (check.cancelled || check.error) return "Dateiprüfung abgebrochen oder fehlgeschlagen";
  if (check.report && (check.report.status !== "complete" || check.report.error_count > 0))
    return "Dateiprüfung enthält Befunde oder ist unvollständig";
  return null;
}

export function createCsvFileCheck(
  request: CsvCheckRequest | null,
  run = async (input: CsvCheckRequest, signal: AbortSignal, events: CsvCheckEvents) =>
    (await import("@/lib/csv-file-check-runner")).runCsvFileCheck(input, signal, events),
) {
  let state = IDLE;
  let current: AbortController | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const update = (value: CsvCheckState) => {
    state = value;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate: () => {
      current?.abort();
      current = null;
      update(IDLE);
    },
    cancel: () => {
      if (!current || state.cancelling) return;
      update({ ...state, cancelling: true });
      current.abort();
    },
    dispose: () => {
      disposed = true;
      current?.abort();
      listeners.clear();
    },
    run: async () => {
      if (!request || current || disposed) return;
      const active = new AbortController();
      current = active;
      update({ ...IDLE, checking: true });
      try {
        const report = await run(request, active.signal, {
          onProgress: (rows) => {
            if (
              disposed ||
              current !== active ||
              active.signal.aborted ||
              !Number.isSafeInteger(rows) ||
              rows < 0 ||
              (state.checkedRows !== null && rows <= state.checkedRows)
            )
              return;
            update({ ...state, checkedRows: rows });
          },
          onCancelRequested: () => {
            if (disposed || current !== active || active.signal.aborted) return;
            update({ ...state, cancelling: true });
            active.abort();
          },
        });
        if (!disposed && current === active)
          update(
            active.signal.aborted && report.status === "complete"
              ? { ...IDLE, cancelled: true }
              : { ...IDLE, report },
          );
      } catch (error) {
        if (!disposed && current === active)
          update(
            active.signal.aborted
              ? { ...IDLE, cancelled: true }
              : { ...IDLE, error: String(error) },
          );
      } finally {
        if (current === active) current = null;
      }
    },
  };
}

export function csvCheckMatchesFile(
  report: CsvCheckReport,
  file: { size: number; mtime: Date | null },
) {
  return (
    report.status === "complete" &&
    report.source_modified_ms !== null &&
    file.mtime !== null &&
    file.size === report.source_size &&
    file.mtime.getTime() === report.source_modified_ms
  );
}
