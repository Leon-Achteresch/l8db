export function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** unit).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "–";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("de-DE") : value;
}

export function storageQueryKey(reference: string, ...rest: (string | number)[]) {
  return ["supabase", reference, "studio-storage", ...rest] as const;
}

export function validStorageName(name: string): boolean {
  return Boolean(name) && name !== "." && name !== ".." && !/[/\\]/.test(name);
}
