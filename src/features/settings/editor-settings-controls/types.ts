import type { ReactNode } from "react";
import type { useSettingsStore } from "@/lib/settings";

export type Store = ReturnType<typeof useSettingsStore.getState>;

export interface SectionProps {
  title: string;
  description: string;
  children: ReactNode;
}
