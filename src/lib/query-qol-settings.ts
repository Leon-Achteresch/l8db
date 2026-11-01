import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TimestampOptions } from "@/lib/timestamp-display";
import { syncAcrossWindows } from "@/lib/window-sync";

const KEY = "l8db.query-qol";

interface QueryQolSettings {
  timestamps: TimestampOptions;
  notifications: boolean;
  setTimestamps: (value: TimestampOptions) => void;
  setNotifications: (value: boolean) => void;
}

export const useQueryQolSettings = create<QueryQolSettings>()(
  persist(
    (set) => ({
      timestamps: { mode: "raw", precision: "seconds" },
      notifications: false,
      setTimestamps: (timestamps) => set({ timestamps }),
      setNotifications: (notifications) => set({ notifications }),
    }),
    {
      name: KEY,
      version: 1,
      partialize: ({ timestamps, notifications }) => ({ timestamps, notifications }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<QueryQolSettings> | null;
        const timestamps = saved?.timestamps;
        return {
          ...current,
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
