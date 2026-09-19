import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";

export function copyCellValue(val: unknown) {
  if (val === undefined || val === null) return;
  const stringVal = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
  void copyText(stringVal);
  toast.success("In die Zwischenablage kopiert!");
}
