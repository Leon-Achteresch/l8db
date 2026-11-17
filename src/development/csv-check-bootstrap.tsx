import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { csvCheckDevelopmentContext } from "@/lib/db/csv-check-development";

export async function startCsvCheckDevelopment() {
  const context = await csvCheckDevelopmentContext();
  const { CsvCheckDevelopment } = await import("./csv-check-development");
  const root = document.getElementById("root");
  if (!root) throw Error("Prüffenster fehlt.");
  createRoot(root).render(createElement(CsvCheckDevelopment, { directory: context.directory }));
}
