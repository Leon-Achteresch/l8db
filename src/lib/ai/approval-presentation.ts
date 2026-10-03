export function approvalSummary(
  details: Record<string, unknown>,
): { label: string; value: string }[] {
  const records: Record<string, unknown>[] = [details];
  for (let depth = 0; depth < 2; depth++)
    for (const entry of [...records])
      for (const key of ["rawInput", "input", "arguments", "args", "params", "_meta", "toolCall"]) {
        const value = entry[key];
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          !records.includes(value as Record<string, unknown>)
        )
          records.push(value as Record<string, unknown>);
      }
  const result: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => {
    const text =
      typeof value === "string"
        ? value
        : Array.isArray(value)
          ? value.filter((item) => typeof item === "string").join(" · ")
          : "";
    if (text && !result.some((entry) => entry.label === label && entry.value === text))
      result.push({ label, value: text });
  };
  for (const record of records) {
    add("Aktion", record.title ?? record.tool_name ?? record.toolName ?? record.name);
    add(
      "Verbindung",
      record.connectionName ?? record.connection ?? record.database ?? record.connectionId,
    );
    add("SQL", record.sql ?? record.query);
    add("Befehl", record.command ?? record.cmd);
    add("Arbeitsverzeichnis", record.cwd);
    add("Datei", record.path ?? record.file_path ?? record.filePath);
    add("Ziel", record.url);
    const changes = record.fileChanges ?? record.changes ?? record.locations;
    if (Array.isArray(changes))
      add(
        "Dateien",
        changes
          .map((item) =>
            typeof item === "string"
              ? item
              : item && typeof item === "object"
                ? String(item.path ?? item.filePath ?? item.file_path ?? "")
                : "",
          )
          .filter(Boolean),
      );
    else if (changes && typeof changes === "object") add("Dateien", Object.keys(changes));
    if (record.permissions && typeof record.permissions === "object") {
      const collect = (value: unknown, prefix: string): string[] => {
        if (typeof value === "string" || typeof value === "number") return [`${prefix}: ${value}`];
        if (typeof value === "boolean") return value ? [prefix] : [];
        if (Array.isArray(value)) return value.flatMap((item) => collect(item, prefix));
        if (value && typeof value === "object")
          return Object.entries(value).flatMap(([key, item]) =>
            collect(item, prefix ? `${prefix}.${key}` : key),
          );
        return [];
      };
      add("Berechtigungen", collect(record.permissions, ""));
    }
  }
  return result;
}
