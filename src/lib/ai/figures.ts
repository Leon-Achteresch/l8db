import { createContext, useContext, useMemo } from "react";

export interface AiFigureScope {
  numbers: Map<string, number>;
  shelf: boolean;
  focused: string | null;
  focus: (id: string) => void;
}

export const AiFigureContext = createContext<AiFigureScope>({
  numbers: new Map(),
  shelf: false,
  focused: null,
  focus: () => undefined,
});

export const useAiFigures = () => useContext(AiFigureContext);

export function useAiFigureNumbers(figures: { id: string }[]) {
  const key = figures.map((figure) => figure.id).join("\n");
  return useMemo(
    () => new Map<string, number>(key ? key.split("\n").map((id, index) => [id, index + 1]) : []),
    [key],
  );
}
