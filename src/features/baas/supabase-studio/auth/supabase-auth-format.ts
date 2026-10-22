export function formatAuthDate(value?: string | null): string {
  if (!value) return "–";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("de-DE") : value;
}

export function isAuthBanned(until?: string | null): boolean {
  if (!until) return false;
  const timestamp = Date.parse(until);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

export function parseJsonObject(text: string): Record<string, unknown> | string {
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return "Erwartet wird ein JSON-Objekt.";
  } catch (error) {
    return `Ungültiges JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}
