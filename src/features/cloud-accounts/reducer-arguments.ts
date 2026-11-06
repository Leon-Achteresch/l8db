export function parseReducerArgument(raw: string, typeName: string): unknown {
  const text = raw.trim();
  if (typeName === "String") {
    if (text.startsWith('"')) return JSON.parse(text);
    return raw;
  }
  if (!text) throw new Error("Bitte alle Argumente ausfüllen.");
  return JSON.parse(text);
}
