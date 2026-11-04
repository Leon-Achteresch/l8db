import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { showCopiedMessage } from "@/lib/workspace-status";

export async function copyText(
  text: string,
  message = "In die Zwischenablage kopiert",
): Promise<void> {
  try {
    await writeText(text);
  } catch {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      toast.error("Kopieren fehlgeschlagen: Kein Zugriff auf die Zwischenablage.");
      throw error;
    }
  }
  showCopiedMessage(message);
}

export async function copyWithToast(text: string, label: string): Promise<void> {
  await copyText(text, `${label} kopiert.`);
}

export function copyNameActions(name: string, qualifiedName: string) {
  return {
    copyName: () => void copyWithToast(name, "Name"),
    copyQualifiedName: () => void copyWithToast(qualifiedName, "Vollständiger Name"),
  };
}

export async function pasteText(): Promise<string> {
  try {
    return await readText();
  } catch {
    return await navigator.clipboard.readText();
  }
}
