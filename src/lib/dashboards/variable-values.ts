import { create } from "zustand";
import type { VariableValues } from "./variables";

interface VariableValuesState {
  values: Record<string, VariableValues>;
  set: (dashboardId: string, name: string, value: string) => void;
  reset: (dashboardId: string) => void;
}

export const useVariableValuesStore = create<VariableValuesState>()((set) => ({
  values: {},
  set: (dashboardId, name, value) =>
    set((state) => ({
      values: {
        ...state.values,
        [dashboardId]: { ...state.values[dashboardId], [name]: value },
      },
    })),
  reset: (dashboardId) =>
    set((state) => {
      const values = { ...state.values };
      delete values[dashboardId];
      return { values };
    }),
}));
