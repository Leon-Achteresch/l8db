import { createContext, useContext } from "react";

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
