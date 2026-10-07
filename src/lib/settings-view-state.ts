import { create } from "zustand";

interface SettingsViewState {
  category: string;
  query: string;
  modifiedOnly: boolean;
  setCategory: (category: string) => void;
  setQuery: (query: string) => void;
  setModifiedOnly: (modifiedOnly: boolean) => void;
}

export const useSettingsViewState = create<SettingsViewState>((set) => ({
  category: "general",
  query: "",
  modifiedOnly: false,
  setCategory: (category) => set({ category, query: "", modifiedOnly: false }),
  setQuery: (query) => set({ query }),
  setModifiedOnly: (modifiedOnly) => set({ modifiedOnly }),
}));
