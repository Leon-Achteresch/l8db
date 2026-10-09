import { create } from "zustand";

export interface WidgetDetailsRequest {
  title: string;
  subtitle: string;
  sql: string;
}

export const useWidgetDetailsStore = create<{
  request: WidgetDetailsRequest | null;
  open: (request: WidgetDetailsRequest) => void;
  close: () => void;
}>()((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));
