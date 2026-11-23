export function jsonFilterError(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return null;
  } catch {}
  return 'Der Filter muss ein gültiges JSON-Objekt sein, z. B. {"status": "open"}.';
}
