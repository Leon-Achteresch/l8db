export function columnTypeLabel(dataType: string, maxLength: number | null | undefined): string {
  if (maxLength == null || dataType.includes("(") || /(text|blob)$/i.test(dataType)) {
    return dataType;
  }
  return `${dataType}(${maxLength === -1 ? "max" : maxLength})`;
}
