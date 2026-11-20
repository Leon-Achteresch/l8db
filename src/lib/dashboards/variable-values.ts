import { create } from "zustand";
import type { VariableValues } from "./variables";

interface VariableValuesState {
  values: Record<string, VariableValues>;
  set: (dashboardId: string, name: string, value: string) => void;
  reset: (dashboardId: string) => void;
  clear: (dashboardId: string, name: string) => void;
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
  clear: (dashboardId, name) =>
    set((state) => {
      const current = { ...state.values[dashboardId] };
      delete current[name];
      return { values: { ...state.values, [dashboardId]: current } };
    }),
  reset: (dashboardId) =>
    set((state) => {
      const values = { ...state.values };
      delete values[dashboardId];
      return { values };
    }),
}));
