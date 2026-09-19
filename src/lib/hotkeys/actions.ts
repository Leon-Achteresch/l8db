export const HOTKEY_ACTION_EVENT = "l8db:hotkey";

export function emitHotkeyAction(id: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(HOTKEY_ACTION_EVENT, { detail: id }));
}

export function onHotkeyAction(id: string, handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === id) handler();
  };
  window.addEventListener(HOTKEY_ACTION_EVENT, listener);
  return () => window.removeEventListener(HOTKEY_ACTION_EVENT, listener);
}
