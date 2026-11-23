import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { arrayEditorDevelopmentContext } from "@/lib/db/array-editor-development";

export async function startArrayEditorDevelopment() {
  const context = await arrayEditorDevelopmentContext();
  const { ArrayEditorDevelopment } = await import("./array-editor-development");
  const root = document.getElementById("root");
  if (!root) throw Error("Editorfenster fehlt.");
  createRoot(root).render(createElement(ArrayEditorDevelopment, { context }));
}
