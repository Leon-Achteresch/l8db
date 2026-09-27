export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function errorStackOf(error: unknown): string | null {
  if (error instanceof Error && typeof error.stack === "string") return error.stack;
  return null;
}

export function isChunkFailure(message: string): boolean {
  return /dynamically imported module|importing a module script failed|outdated optimize dep|loading chunk|chunkloaderror|failed to fetch|504/i.test(
    message,
  );
}
