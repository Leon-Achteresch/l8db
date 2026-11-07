import { copyText } from "@/lib/clipboard";

export function copyCellValue(val: unknown) {
  if (val === undefined || val === null) {
    void copyText("", "NULL als leeren Text kopiert.");
    return;
  }
  const stringVal = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
  void copyText(stringVal, "In die Zwischenablage kopiert!");
}
