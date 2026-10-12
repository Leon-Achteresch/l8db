import { createContext } from "react";

export const WorkbenchContext = createContext<string | null>(null);
export const WorkbenchDatabaseContext = createContext<{ database: string | null } | null>(null);
