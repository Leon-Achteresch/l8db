import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { create } from "zustand";

export interface StudioPaletteTable {
  schema?: string;
  name: string;
}

export interface StudioPaletteTables {
  load: () => Promise<StudioPaletteTable[]>;
  open: (table: StudioPaletteTable) => unknown;
}

export interface StudioPaletteScope {
  key: string;
  label: string;
  sections: { id: string; label: string; icon: LucideIcon; disabled?: boolean }[];
  openSection: (id: string) => unknown;
  tables?: StudioPaletteTables;
}

export interface StudioPaletteEntry {
  key: string;
  hasTables: boolean;
  read: () => StudioPaletteScope;
}

export const useStudioPalette = create<{ entry: StudioPaletteEntry | null }>(() => ({
  entry: null,
}));

export function useStudioPaletteScope(scope: StudioPaletteScope) {
  const latest = useRef(scope);
  latest.current = scope;
  const hasTables = Boolean(scope.tables);

  useEffect(() => {
    const entry: StudioPaletteEntry = {
      key: scope.key,
      hasTables,
      read: () => latest.current,
    };
    useStudioPalette.setState({ entry });
    return () => {
      if (useStudioPalette.getState().entry === entry) useStudioPalette.setState({ entry: null });
    };
  }, [scope.key, hasTables]);
}
