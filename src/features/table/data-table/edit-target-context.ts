import { createContext } from "react";

export const EditTargetContext = createContext<{ schema: string; table: string } | null>(null);
