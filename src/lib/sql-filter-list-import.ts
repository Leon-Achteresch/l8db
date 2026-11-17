import { parseFilterList } from "./sql-filter";

export const MAX_SQL_LIST_CHARACTERS = 128 * 1024;
export const MAX_SQL_LIST_VALUES = 1_000;
const MAX_ENCODED_CHARACTERS = MAX_SQL_LIST_CHARACTERS * 4;

type Failure = { ok: false; error: string };
type Parsed = { ok: true; values: string[] } | Failure;

export type SqlFilterListImport =
  | { ok: true; values: string[]; encoded: string; added: number; total: number }
  | Failure;

export function looksLikeSqlFilterList(text: string): boolean {
  return /^\s*\(\s*(?:n?'|[+-]?\d|true\b|false\b|null\b)/i.test(text);
}

export function parseSqlFilterList(text: string): Parsed {
  if (text.length > MAX_SQL_LIST_CHARACTERS)
    return { ok: false, error: "Die SQL-Liste ist zu lang für diese Übernahme." };
  let index = 0;
  const fail = (error: string): Failure => ({
    ok: false,
    error: `${error} (Zeichen ${index + 1})`,
  });
  const space = () => {
    while (index < text.length && /\s/.test(text[index])) index++;
  };
  space();
  if (text[index++] !== "(") return fail("Die Liste muss mit ( beginnen.");
  const values: string[] = [];
  while (index < text.length) {
    space();
    if (values.length >= MAX_SQL_LIST_VALUES) return fail("Höchstens 1.000 Werte pro SQL-Liste.");
    let value = "";
    if (/n/i.test(text[index] ?? "") && text[index + 1] === "'") index++;
    if (text[index] === "'") {
      index++;
      let closed = false;
      while (index < text.length) {
        const ch = text[index++];
        if (ch === "\\")
          return fail("Backslash-Escapes sind dialektabhängig; Werte einzeln eingeben.");
        if (ch === "\0") return fail("NUL-Zeichen sind nicht unterstützt.");
        if (ch === "'") {
          if (text[index] === "'") {
            value += "'";
            index++;
          } else {
            closed = true;
            break;
          }
        } else value += ch;
      }
      if (!closed) return fail("Schließendes ' fehlt.");
      if (!value.trim())
        return fail("Leere oder nur aus Leerzeichen bestehende Werte sind hier nicht unterstützt.");
    } else {
      const start = index;
      while (index < text.length && text[index] !== "," && text[index] !== ")") index++;
      value = text.slice(start, index).trim();
      if (/^null$/i.test(value))
        return fail("SQL-NULL ist kein Listenwert; den NULL-Filter verwenden.");
      if (/^(true|false)$/i.test(value)) value = value.toLowerCase();
      else if (!/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))
        return fail("Nur Textliterale, Dezimalzahlen oder true/false; keine SQL-Ausdrücke.");
    }
    values.push(value);
    space();
    if (text[index] === ",") {
      index++;
      continue;
    }
    if (text[index++] !== ")") return fail("Komma oder schließende ) erwartet.");
    space();
    return index === text.length
      ? { ok: true, values }
      : fail("Nach der Liste ist kein weiterer SQL-Text erlaubt.");
  }
  return fail("Die Liste ist unvollständig.");
}

export function prepareSqlFilterListImport(source: string, current: string): SqlFilterListImport {
  if (current.length > MAX_ENCODED_CHARACTERS)
    return { ok: false, error: "Die vorhandene Filterliste ist für diese Übernahme zu groß." };
  const parsed = parseSqlFilterList(source);
  if (!parsed.ok) return parsed;
  const previous = new Set(parseFilterList(current));
  const values = [...new Set(parsed.values)];
  const combined = new Set([...previous, ...values]);
  if (combined.size > MAX_SQL_LIST_VALUES)
    return {
      ok: false,
      error: "Die Übernahme darf insgesamt höchstens 1.000 Filterwerte ergeben.",
    };
  const encoded = JSON.stringify([...combined]);
  if (encoded.length > MAX_ENCODED_CHARACTERS)
    return { ok: false, error: "Die zusammengeführte Filterliste ist zu groß." };
  return { ok: true, values, encoded, added: combined.size - previous.size, total: combined.size };
}
