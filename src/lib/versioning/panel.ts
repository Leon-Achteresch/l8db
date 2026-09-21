import { create } from "zustand";
import { useTransactionStore } from "@/lib/transactions";

interface VersioningPanelState {
  open: boolean;
  pending: number;
  hasError: boolean;
  setOpen: (open: boolean) => void;
  setAttention: (pending: number, hasError: boolean) => void;
}

export const useVersioningPanel = create<VersioningPanelState>((set) => ({
  open: false,
  pending: 0,
  hasError: false,
  setOpen: (open) => {
    if (open) useTransactionStore.getState().setPanelOpen(false);
    set({ open });
  },
  setAttention: (pending, hasError) => set({ pending, hasError }),
}));
