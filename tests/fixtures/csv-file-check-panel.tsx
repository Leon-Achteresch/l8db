import { CsvFileCheck } from "../../src/features/import/csv-file-check";
import { useCsvFileCheck } from "../../src/features/import/csv-import-panel/use-csv-file-check";
import type { CsvCheckRequest } from "../../src/lib/db";

export function CheckPanel({
  request,
  scope,
  pick,
}: {
  request: CsvCheckRequest;
  scope: string;
  pick: () => void;
}) {
  const check = useCsvFileCheck(request, scope);
  return <CsvFileCheck check={check} importing={false} onPickFile={pick} />;
}
