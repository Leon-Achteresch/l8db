import { create } from "zustand";
import { persist } from "zustand/middleware";

export const PACKAGE_OUTLINE_MIN_WIDTH = 160;
export const PACKAGE_OUTLINE_MAX_WIDTH = 480;
export const PACKAGE_OUTLINE_DEFAULT_WIDTH = 224;

interface PackageViewPrefsState {
  widths: Record<string, number>;
  setWidth: (key: string, width: number) => void;
}

export function packageOutlinePrefKey(
  connectionId: string,
  schema: string,
  name: string,
): string {
  return `${connectionId}:${schema}.${name}`;
}

export function clampPackageOutlineWidth(width: number): number {
  return Math.min(
    PACKAGE_OUTLINE_MAX_WIDTH,
    Math.max(PACKAGE_OUTLINE_MIN_WIDTH, Math.round(width)),
  );
}

export const usePackageViewPrefs = create<PackageViewPrefsState>()(
  persist(
    (set) => ({
      widths: {},
      setWidth: (key, width) =>
        set((state) => ({
          widths: { ...state.widths, [key]: clampPackageOutlineWidth(width) },
        })),
    }),
    { name: "l8db.package-view" },
  ),
);
