import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import {
  type NumberDisplayOptions,
  normalizeNumberDisplay,
  RAW_NUMBER_DISPLAY,
} from "@/lib/number-display";
import type { TimestampOptions } from "@/lib/timestamp-display";
import { syncAcrossWindows } from "@/lib/window-sync";

const KEY = "l8db.query-qol";

interface QueryQolSettings {
  numbers: NumberDisplayOptions;
  setNumbers: (value: NumberDisplayOptions) => void;
  timestamps: TimestampOptions;
  notifications: boolean;
  setTimestamps: (value: TimestampOptions) => void;
  setNotifications: (value: boolean) => void;
}

export const useQueryQolSettings = create<QueryQolSettings>()(
  persist(
    (set) => ({
      numbers: RAW_NUMBER_DISPLAY,
      setNumbers: (value) => set({ numbers: normalizeNumberDisplay(value) }),
      timestamps: { mode: "raw", precision: "seconds" },
      notifications: false,
      setTimestamps: (timestamps) => set({ timestamps }),
      setNotifications: (notifications) => set({ notifications }),
    }),
    {
      name: KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: ({ timestamps, notifications, numbers }) => ({
        timestamps,
        notifications,
        numbers,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<QueryQolSettings> | null;
        const timestamps = saved?.timestamps;
        return {
          ...current,
          numbers: normalizeNumberDisplay(saved?.numbers),
          notifications: saved?.notifications === true,
          timestamps: {
            mode:
              timestamps?.mode === "utc" || timestamps?.mode === "local" ? timestamps.mode : "raw",
            precision: timestamps?.precision === "milliseconds" ? "milliseconds" : "seconds",
          },
        };
      },
    },
  ),
);

syncAcrossWindows(KEY, () => void useQueryQolSettings.persist.rehydrate());
