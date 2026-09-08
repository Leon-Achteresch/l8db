import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export async function pasteText(): Promise<string> {
  try {
    return await readText();
  } catch {
    return await navigator.clipboard.readText();
  }
}
