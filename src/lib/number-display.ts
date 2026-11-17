export type NumberDisplayOptions = {
  mode: "raw" | "grouped";
  minimumFractionDigits: 0 | 2 | 4;
};

export const RAW_NUMBER_DISPLAY: NumberDisplayOptions = { mode: "raw", minimumFractionDigits: 0 };
export const MAX_NUMBER_DISPLAY_CHARACTERS = 4_096;

export function normalizeNumberDisplay(value: unknown): NumberDisplayOptions {
  const saved = value as Partial<NumberDisplayOptions> | null | undefined;
  return {
    mode: saved?.mode === "grouped" ? "grouped" : "raw",
    minimumFractionDigits:
      saved?.minimumFractionDigits === 2 || saved?.minimumFractionDigits === 4
        ? saved.minimumFractionDigits
        : 0,
  };
}

export function isNumericDisplayType(dataType?: string | null): boolean {
  if (!dataType || dataType.length > 256) return false;
  let type = dataType.trim().toLowerCase();
  for (let i = 0; i < 4; i++) {
    const wrapped = /^(?:nullable|lowcardinality)\((.*)\)$/.exec(type);
    if (!wrapped) break;
    type = wrapped[1].trim();
  }
  return /^(?:u?int(?:eger|8|16|32|64|128|256)?|int2|int4|smallint|bigint|tinyint|mediumint|smallserial|serial|bigserial|float(?:4|8|32|64)?|real|double(?: precision)?|binary_float|binary_double|dec(?:imal)?(?:32|64|128|256)?|numeric|number|money|smallmoney)(?:\s*\(\s*\d+(?:\s*,\s*-?\d+)?\s*\))?(?:\s+unsigned)?$/.test(
    type,
  );
}

export function numberCellText(
  value: unknown,
  options: NumberDisplayOptions,
  dataType?: string | null,
): string | null {
  if (options?.mode !== "grouped") return null;
  const numericType = isNumericDisplayType(dataType);
  if (dataType && !numericType) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !numericType) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = typeof value === "number" && Object.is(value, -0) ? "-0" : String(value);
  if (text.length > MAX_NUMBER_DISPLAY_CHARACTERS) return null;
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))([eE][+-]?\d+)?$/.exec(text);
  if (!match) return null;
  const whole = match[2] ?? "0";
  const minimum =
    options.minimumFractionDigits === 2 || options.minimumFractionDigits === 4
      ? options.minimumFractionDigits
      : 0;
  const fraction = (match[3] ?? match[4] ?? "").padEnd(minimum, "0");
  let grouped = "";
  for (let index = 0; index < whole.length; index++) {
    if (index > 0 && (whole.length - index) % 3 === 0) grouped += "\u202f";
    grouped += whole[index];
  }
  const point = fraction.length > 0 || match[3] !== undefined || match[4] !== undefined;
  return `${match[1]}${grouped}${point ? `.${fraction}` : ""}${match[5] ?? ""}`;
}
