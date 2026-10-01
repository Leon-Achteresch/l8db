const SEPARATOR = `\n\n${"=".repeat(80)}\n`;

export function licenseSections(text: string, query: string): string[] {
  if (!text) return [];
  const [header, ...rest] = text.split(SEPARATOR);
  const sections = [header, ...rest.map((section) => `${"=".repeat(80)}\n${section}`)];
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return rest
    .map((section) => `${"=".repeat(80)}\n${section}`)
    .filter((section) => section.toLowerCase().includes(needle));
}
