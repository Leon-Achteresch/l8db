import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { NOTEBOOK_EXTENSION, type NotebookDoc, type NotebookOutput, parseNotebook } from "./model";

function safeName(name: string): string {
  return name.replace(/[^\w-]+/g, "_") || "notebook";
}

export async function pickNotebookFile(): Promise<string | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "l8db-Notebook", extensions: [NOTEBOOK_EXTENSION] }],
  });
  return typeof path === "string" ? path : null;
}

export async function readNotebookFile(
  path: string,
): Promise<{ doc: NotebookDoc; outputs: Record<string, NotebookOutput> }> {
  return parseNotebook(await readTextFile(path));
}

export async function pickNotebookTarget(name: string): Promise<string | null> {
  return await save({
    defaultPath: `${safeName(name)}.${NOTEBOOK_EXTENSION}`,
    filters: [{ name: "l8db-Notebook", extensions: [NOTEBOOK_EXTENSION] }],
  });
}

export async function writeExportFile(
  name: string,
  extension: "md" | "html",
  content: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: `${safeName(name)}.${extension}`,
    filters: [{ name: extension === "md" ? "Markdown" : "HTML", extensions: [extension] }],
  });
  if (path) await writeTextFile(path, content);
  return path;
}

export { writeTextFile as writeNotebookText };
