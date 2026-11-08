import { create } from "zustand";

export interface VisibleWaitTip {
  id: string;
  text: string;
  hotkey?: string;
}

export const useWaitTipStore = create<{
  tip: VisibleWaitTip | null;
  commit: (() => void) | null;
}>()(() => ({ tip: null, commit: null }));

export function commitWaitTip(): void {
  const { commit } = useWaitTipStore.getState();
  if (!commit) return;
  useWaitTipStore.setState({ commit: null });
  commit();
}

export function useWaitTip(): VisibleWaitTip | null {
  return useWaitTipStore((state) => state.tip);
}
