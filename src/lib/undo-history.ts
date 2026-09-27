import { debounce } from "@tanstack/react-pacer";

export const HISTORY_LIMIT = 100;

export function groupRapidEdits<T extends (...args: never[]) => void>(handleSet: T) {
  return debounce(handleSet, { wait: 400, leading: true, trailing: false });
}
