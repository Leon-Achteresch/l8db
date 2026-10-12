const pending = new Map<string, string>();

export function queueQuerySnippet(id: string, body: string): void {
  pending.set(id, body);
}

export function takeQuerySnippet(id: string): string | undefined {
  const body = pending.get(id);
  pending.delete(id);
  return body;
}
