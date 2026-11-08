import { create } from "zustand";

export interface VisibleWaitTip {
  id: string;
  text: string;
  hotkey?: string;
}

export const useWaitTipStore = create<{ tip: VisibleWaitTip | null }>()(() => ({ tip: null }));

export function useWaitTip(): VisibleWaitTip | null {
  return useWaitTipStore((state) => state.tip);
}
