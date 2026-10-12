import type { DriftEntry } from "./drift";

export function changeSummary(
  entries: DriftEntry[] | null,
  changes: Map<string, string>,
  selectedFiles: string[],
  selectedDrift: string[],
) {
  const shadowed = new Set<string>();
  for (const entry of entries ?? [])
    for (const file of [entry.object.path, entry.object.bodyPath])
      if (file && changes.has(file)) shadowed.add(file);
  const files = changes.size - shadowed.size;
  const database = entries?.length ?? 0;
  const chosenFiles = selectedFiles.filter((file) => !shadowed.has(file));
  return {
    shadowed: [...shadowed],
    files,
    database,
    total: database + files,
    selected: selectedDrift.length + chosenFiles.length,
    selectableFiles: [...changes.keys()].filter((file) => !shadowed.has(file)),
  };
}
