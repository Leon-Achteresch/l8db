export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;
export const XLSX_SHEET_NAME_MAX = 31;
export const DEFAULT_SHEET_NAME = "Daten";

const INVALID_SHEET_CHARS = ["\\", "/", "?", "*", "[", "]", ":"];

let crcTable: Uint32Array | null = null;

function crcLookup(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = crcLookup();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function sheetNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Blattname darf nicht leer sein.";
  if (trimmed.length > XLSX_SHEET_NAME_MAX)
    return `Blattname darf höchstens ${XLSX_SHEET_NAME_MAX} Zeichen haben.`;
  const bad = INVALID_SHEET_CHARS.filter((ch) => trimmed.includes(ch));
  if (bad.length > 0)
    return `Blattname darf diese Zeichen nicht enthalten: ${bad.join(" ")}`;
  if (trimmed.startsWith("'") || trimmed.endsWith("'"))
    return "Blattname darf nicht mit einem Apostroph beginnen oder enden.";
  return null;
}

export function columnRef(index: number): string {
  let n = index + 1;
  let ref = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    ref = String.fromCharCode(65 + rest) + ref;
    n = Math.floor((n - 1) / 26);
  }
  return ref;
}

export function escapeXml(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&apos;";
    else if (code === 0x09 || code === 0x0a || code === 0x0d) out += ch;
    else if (code < 0x20) continue;
    else out += ch;
  }
  return out;
}

const NUMERIC_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

export function isNumericCellText(text: string): boolean {
  if (!NUMERIC_PATTERN.test(text)) return false;
  const digits = text.replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (digits.length > 15) return false;
  const parsed = Number(text);
  return Number.isFinite(parsed);
}

export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export type XlsxCell = { kind: "empty" } | { kind: "number"; text: string } | { kind: "text"; text: string };

export function cellFor(value: unknown, nullText = ""): XlsxCell {
  const text = cellText(value) ?? nullText;
  if (text === "") return { kind: "empty" };
  if (typeof value === "number" || typeof value === "bigint") {
    return isNumericCellText(text) ? { kind: "number", text } : { kind: "text", text };
  }
  if (typeof value !== "string") return { kind: "text", text };
  return isNumericCellText(text) ? { kind: "number", text } : { kind: "text", text };
}

export interface XlsxOptions {
  sheetName?: string;
  header?: boolean;
  nullText?: string;
}

export interface XlsxInput {
  columns: string[];
  rows: Record<string, unknown>[];
  options?: XlsxOptions;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function cellXml(ref: string, cell: XlsxCell, styleIndex: number): string {
  const style = styleIndex > 0 ? ` s="${styleIndex}"` : "";
  if (cell.kind === "empty") return `<c r="${ref}"${style}/>`;
  if (cell.kind === "number") return `<c r="${ref}"${style}><v>${cell.text}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.text)}</t></is></c>`;
}

function sheetXml(input: XlsxInput): string {
  const columns = input.columns;
  const header = input.options?.header !== false;
  const nullText = input.options?.nullText ?? "";
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  );
  let rowIndex = 1;
  if (header) {
    const cells = columns
      .map((column, i) => cellXml(`${columnRef(i)}${rowIndex}`, { kind: "text", text: column }, 1))
      .join("");
    parts.push(`<row r="${rowIndex}">${cells}</row>`);
    rowIndex += 1;
  }
  for (const row of input.rows) {
    const cells = columns
      .map((column, i) => cellXml(`${columnRef(i)}${rowIndex}`, cellFor(row[column], nullText), 0))
      .join("");
    parts.push(`<row r="${rowIndex}">${cells}</row>`);
    rowIndex += 1;
  }
  parts.push("</sheetData></worksheet>");
  return parts.join("");
}

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function writeUint16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + nameBytes.length + entry.data.length);
    writeUint32(local, 0, 0x04034b50);
    writeUint16(local, 4, 20);
    writeUint16(local, 6, 0x0800);
    writeUint16(local, 8, 0);
    writeUint16(local, 10, 0);
    writeUint16(local, 12, 0x0021);
    writeUint32(local, 14, crc);
    writeUint32(local, 18, entry.data.length);
    writeUint32(local, 22, entry.data.length);
    writeUint16(local, 26, nameBytes.length);
    writeUint16(local, 28, 0);
    local.set(nameBytes, 30);
    local.set(entry.data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    writeUint32(central, 0, 0x02014b50);
    writeUint16(central, 4, 20);
    writeUint16(central, 6, 20);
    writeUint16(central, 8, 0x0800);
    writeUint16(central, 10, 0);
    writeUint16(central, 12, 0);
    writeUint16(central, 14, 0x0021);
    writeUint32(central, 16, crc);
    writeUint32(central, 20, entry.data.length);
    writeUint32(central, 24, entry.data.length);
    writeUint16(central, 28, nameBytes.length);
    writeUint16(central, 30, 0);
    writeUint16(central, 32, 0);
    writeUint16(central, 34, 0);
    writeUint16(central, 36, 0);
    writeUint32(central, 38, 0);
    writeUint32(central, 42, offset);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const localSize = locals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  writeUint32(eocd, 0, 0x06054b50);
  writeUint16(eocd, 4, 0);
  writeUint16(eocd, 6, 0);
  writeUint16(eocd, 8, entries.length);
  writeUint16(eocd, 10, entries.length);
  writeUint32(eocd, 12, centralSize);
  writeUint32(eocd, 16, localSize);
  writeUint16(eocd, 20, 0);

  const out = new Uint8Array(localSize + centralSize + eocd.length);
  let cursor = 0;
  for (const part of locals) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centrals) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(eocd, cursor);
  return out;
}

export function xlsxInputError(input: XlsxInput): string | null {
  const name = input.options?.sheetName ?? DEFAULT_SHEET_NAME;
  const nameError = sheetNameError(name);
  if (nameError) return nameError;
  if (input.columns.length === 0) return "Keine Spalten für den Export vorhanden.";
  if (input.columns.length > XLSX_MAX_COLUMNS)
    return `Excel unterstützt höchstens ${XLSX_MAX_COLUMNS} Spalten, gewählt sind ${input.columns.length}.`;
  const rowCount = input.rows.length + (input.options?.header === false ? 0 : 1);
  if (rowCount > XLSX_MAX_ROWS)
    return `Excel unterstützt höchstens ${XLSX_MAX_ROWS} Zeilen, benötigt werden ${rowCount}.`;
  return null;
}

export function buildXlsx(input: XlsxInput): Uint8Array {
  const error = xlsxInputError(input);
  if (error) throw new Error(error);
  const sheetName = (input.options?.sheetName ?? DEFAULT_SHEET_NAME).trim();
  return buildZip([
    { name: "[Content_Types].xml", data: encode(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", data: encode(ROOT_RELS_XML) },
    { name: "xl/workbook.xml", data: encode(workbookXml(sheetName)) },
    { name: "xl/_rels/workbook.xml.rels", data: encode(WORKBOOK_RELS_XML) },
    { name: "xl/styles.xml", data: encode(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: encode(sheetXml(input)) },
  ]);
}

export function xlsxSheetXml(input: XlsxInput): string {
  return sheetXml(input);
}
