import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

export async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export async function copyWithToast(text: string, label: string): Promise<void> {
  await copyText(text);
  toast.success(`${label} kopiert.`);
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
