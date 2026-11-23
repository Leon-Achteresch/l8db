import { createContext } from "react";

export const BusinessTimeZoneContext = createContext<(() => void) | null>(null);
