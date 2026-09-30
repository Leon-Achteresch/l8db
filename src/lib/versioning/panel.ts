import { create } from "zustand";
import { useTransactionStore } from "@/lib/transactions";

interface VersioningPanelState {
  open: boolean;
  pending: number;
  hasError: boolean;
  mode: "panel" | "tab";
  tabHost: HTMLElement | null;
  returnPath: string;
  setMode: (mode: "panel" | "tab") => void;
  setTabHost: (host: HTMLElement | null) => void;
  setReturnPath: (path: string) => void;
  setOpen: (open: boolean) => void;
  setAttention: (pending: number, hasError: boolean) => void;
}

export const useVersioningPanel = create<VersioningPanelState>((set) => ({
  open: false,
  pending: 0,
  hasError: false,
  mode:
    typeof localStorage !== "undefined" && localStorage.getItem("l8db.versioning.mode") === "tab"
      ? "tab"
      : "panel",
  tabHost: null,
  returnPath: "/query",
  setMode: (mode) => {
    localStorage.setItem("l8db.versioning.mode", mode);
    set({ mode });
  },
  setTabHost: (tabHost) => set({ tabHost }),
  setReturnPath: (returnPath) => set({ returnPath }),
  setOpen: (open) => {
    if (open) useTransactionStore.getState().setPanelOpen(false);
    set({ open });
  },
  setAttention: (pending, hasError) => set({ pending, hasError }),
}));
