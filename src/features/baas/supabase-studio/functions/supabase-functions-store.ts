import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

const STORAGE_KEY = "l8db.supabase-studio.function-slugs";
const MAX_SLUGS = 100;

export const FUNCTION_SLUG = /^[A-Za-z0-9_-]{1,128}$/;

type FunctionSlugsState = {
  slugs: Record<string, string[]>;
  add: (reference: string, slug: string) => void;
  remove: (reference: string, slug: string) => void;
};

export const useSupabaseFunctionSlugs = create<FunctionSlugsState>()(
  persist(
    (set) => ({
      slugs: {},
      add: (reference, slug) =>
        set((state) => ({
          slugs: {
            ...state.slugs,
            [reference]: [...new Set([slug, ...(state.slugs[reference] ?? [])])].slice(
              0,
              MAX_SLUGS,
            ),
          },
        })),
      remove: (reference, slug) =>
        set((state) => ({
          slugs: {
            ...state.slugs,
            [reference]: (state.slugs[reference] ?? []).filter((item) => item !== slug),
          },
        })),
    }),
    { name: STORAGE_KEY },
  ),
);

syncAcrossWindows(STORAGE_KEY, () => void useSupabaseFunctionSlugs.persist.rehydrate());
