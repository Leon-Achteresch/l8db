import type { SavedConnection } from "@/lib/connections";

export interface ConnectionEditorProps {
  connection?: SavedConnection;
  template?: SavedConnection;
  onSaved: () => void;
  onCancel: () => void;
}
export type Mode = "string" | "fields" | "tns";
export type TestResult = {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
  ms?: number;
};
export const TEST_TIMEOUT_MS = 30_000;
