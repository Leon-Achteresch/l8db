import { buildSchemaChangeReport } from "./report";
import type { SyncScript } from "./script";
import {
  type CompareResult,
  type CompareSide,
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
  defaultCompareTypes,
  type SchemaCompareOptions,
  type SelectableType,
} from "./types";

export interface ReportExportState {
  result: CompareResult | null;
  source: CompareSide;
  target: CompareSide;
  options: SchemaCompareOptions;
  types: SelectableType[] | null;
  selection: Record<string, boolean>;
  renames: Record<string, string>;
  loading: string | null;
  error: string | null;
}

function sameSide(a: CompareSide, b: CompareSide): boolean {
  const signature = (side: CompareSide) =>
    JSON.stringify([
      side.connectionId,
      side.database ?? "",
      side.schema,
      side.snapshot?.path,
      side.snapshot?.createdAt,
      side.snapshot?.kind,
    ]);
  return signature(a) === signature(b);
}

export function schemaReportIssue(state: ReportExportState): string | null {
  const { result } = state;
  if (state.loading) return "Vergleich läuft. Bitte warten.";
  if (state.error) return "Vergleich fehlgeschlagen. Vor dem Bericht neu vergleichen.";
  if (!result) return "Zuerst Quelle und Ziel vergleichen.";
  if (!result.requestedTypes)
    return "Älterer Vergleich ohne belegte Typauswahl. Bitte neu vergleichen.";
  if (result.types.length === 0) return "Kein geprüfter Objekttyp. Bitte neu vergleichen.";
  const supported = compareTypesFor(result.kind);
  const types = (state.types ?? defaultCompareTypes(result.kind)).filter((type) =>
    supported.includes(type),
  );
  const sameTypes =
    types.length === result.requestedTypes.length &&
    types.every((type) => result.requestedTypes?.includes(type));
  if (
    !sameSide(state.source, result.source) ||
    !sameSide(state.target, result.target) ||
    !sameTypes ||
    Object.keys(DEFAULT_COMPARE_OPTIONS).some(
      (key) =>
        state.options[key as keyof SchemaCompareOptions] !==
        result.options[key as keyof SchemaCompareOptions],
    )
  )
    return "Vergleich veraltet: Quelle, Ziel oder Einstellungen geändert. Bitte neu vergleichen.";
  return null;
}

export interface ReportExportIo {
  choosePath: (name: string) => Promise<string | null>;
  write: (path: string, text: string) => Promise<void>;
  copy: (text: string) => Promise<void>;
}

export async function exportSchemaReport(
  action: "copy" | "save",
  initial: ReportExportState,
  getCurrent: () => ReportExportState,
  script: SyncScript,
  io: ReportExportIo,
): Promise<"copied" | "saved" | "cancelled"> {
  const check = () => {
    const current = getCurrent();
    const issue = schemaReportIssue(current);
    if (issue) throw new Error(issue);
    if (
      current.result !== initial.result ||
      current.selection !== initial.selection ||
      current.renames !== initial.renames
    )
      throw new Error("Vergleich oder Skriptauswahl inzwischen geändert. Bericht erneut öffnen.");
  };
  check();
  const path = action === "save" ? await io.choosePath("schemaaenderungsbericht.md") : null;
  if (action === "save" && !path) return "cancelled";
  check();
  const text = buildSchemaChangeReport(initial.result as CompareResult, script);
  if (action === "copy") {
    await io.copy(text);
    return "copied";
  }
  await io.write(path as string, text);
  return "saved";
}
