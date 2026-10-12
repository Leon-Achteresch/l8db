const pending = new Set<string>();

export function requestEditorFocus(id: string): void {
  pending.add(id);
}

export function takeEditorFocus(id: string): boolean {
  return pending.delete(id);
}
