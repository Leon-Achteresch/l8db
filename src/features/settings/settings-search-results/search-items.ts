import { SETTINGS_CATALOG } from "@/lib/settings-catalog";

const CATEGORY_LABELS: Record<string, string> = {
  general: "Allgemein",
  appearance: "Darstellung",
  editor: "SQL-Editor",
  data: "Daten & Abfragen",
  security: "Sicherheit & SSH",
  extensions: "Erweiterungen",
  hotkeys: "Tastenkürzel",
  about: "Über & Updates",
};

export const SEARCH_ITEMS = SETTINGS_CATALOG.map((setting) => ({
  ...setting,
  tabLabel: CATEGORY_LABELS[setting.tabId] ?? setting.tabId,
}));
