import { create } from "zustand";

export const useTableExportRequest = create<{ request: { schema: string; table: string } | null }>(
  () => ({ request: null }),
);
