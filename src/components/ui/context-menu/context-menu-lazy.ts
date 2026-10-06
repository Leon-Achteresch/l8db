import { createContext, type RefObject } from "react";

export type ContextMenuPoint = { x: number; y: number };

export const ContextMenuLazyContext = createContext<{
  live: boolean;
  pending: RefObject<ContextMenuPoint | null>;
  arm: (point: ContextMenuPoint) => void;
} | null>(null);
