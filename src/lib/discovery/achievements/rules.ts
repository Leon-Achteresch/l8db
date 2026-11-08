export type AchievementCondition =
  | { feature: readonly string[]; count?: number }
  | { event: string; count: number }
  | { families: number }
  | { distinct: number };

export interface Achievement {
  id: string;
  title: string;
  summary: string;
  next: readonly string[];
  any: readonly AchievementCondition[];
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "first-query",
    title: "Erste Abfrage",
    summary: "Eine Abfrage ausgeführt.",
    next: ["query.snippets", "query.history"],
    any: [{ feature: ["query.run"] }, { event: "query.executed", count: 1 }],
  },
  {
    id: "hundred-queries",
    title: "Hundert Abfragen",
    summary: "100 Abfragen ausgeführt.",
    next: ["query.parameters.sets", "query.multi-target"],
    any: [{ event: "query.executed", count: 100 }],
  },
  {
    id: "first-explain",
    title: "Erster EXPLAIN",
    summary: "Einen Ausführungsplan angesehen.",
    next: ["index-advisor", "saved-plan"],
    any: [{ feature: ["explain"] }],
  },
  {
    id: "ten-filters",
    title: "Zehn Filter",
    summary: "Zehnmal Tabellen gefiltert.",
    next: ["table.filter.ai", "table.filter.rules"],
    any: [
      { event: "table.filtered", count: 10 },
      { feature: ["table.filter-bar"], count: 10 },
    ],
  },
  {
    id: "first-export",
    title: "Erster Export",
    summary: "Daten exportiert.",
    next: ["automation", "transfer"],
    any: [{ event: "export.done", count: 1 }, { feature: ["table.export"] }],
  },
  {
    id: "first-dashboard",
    title: "Erstes Dashboard",
    summary: "Ein Dashboard geöffnet.",
    next: ["dashboard.filters", "dashboard.present"],
    any: [{ feature: ["dashboard"] }],
  },
  {
    id: "three-families",
    title: "Drei Datenbank-Familien",
    summary: "Mit drei Datenbank-Familien gearbeitet.",
    next: ["compare", "transfer"],
    any: [{ families: 3 }],
  },
  {
    id: "first-automation",
    title: "Erste Automation",
    summary: "Die Automatisierung geöffnet.",
    next: ["automation.schedules", "automation.alerts"],
    any: [{ feature: ["automation"] }],
  },
  {
    id: "er-diagram",
    title: "Kartograf",
    summary: "Ein ER-Diagramm geöffnet.",
    next: ["er-diagram.text-export", "schema-compare"],
    any: [{ feature: ["er-diagram"] }],
  },
  {
    id: "schema-compare",
    title: "Unterschiede gefunden",
    summary: "Schemas verglichen.",
    next: ["versioning", "compare"],
    any: [{ feature: ["schema-compare", "compare"] }],
  },
  {
    id: "ai-chat",
    title: "Gesprächspartner",
    summary: "Den KI-Chat genutzt.",
    next: ["query.ai-edit", "mcp"],
    any: [{ feature: ["ai.chat"] }],
  },
  {
    id: "notebook",
    title: "Notizbuch",
    summary: "Ein Notebook geöffnet.",
    next: ["dashboard", "query.snippets"],
    any: [{ feature: ["notebook"] }],
  },
  {
    id: "snippets",
    title: "Sammler",
    summary: "Snippets genutzt.",
    next: ["query.bookmark", "query.parameters.sets"],
    any: [{ feature: ["query.snippets", "query.bookmark"] }],
  },
  {
    id: "ssh-tunnel",
    title: "Tunnelbauer",
    summary: "Einen SSH-Tunnel eingerichtet.",
    next: ["connections.team", "health"],
    any: [{ feature: ["connections.ssh-tunnel"] }],
  },
  {
    id: "health",
    title: "Hausarzt",
    summary: "Den Datenbankzustand geprüft.",
    next: ["monitor", "sessions"],
    any: [{ feature: ["health", "monitor"] }],
  },
  {
    id: "versioning",
    title: "Versioniert",
    summary: "Die Versionierung geöffnet.",
    next: ["versioning.releases", "versioning.reviews"],
    any: [{ feature: ["versioning"] }],
  },
  {
    id: "explorer",
    title: "Entdecker",
    summary: "Zehn Funktionen ausprobiert.",
    next: [],
    any: [{ distinct: 10 }],
  },
  {
    id: "power-user",
    title: "Profi",
    summary: "25 Funktionen ausprobiert.",
    next: [],
    any: [{ distinct: 25 }],
  },
];
