import type { Page } from "playwright";
import { seedApp } from "./perf-app";

await seedApp(
  {
    addInitScript: async (script: (argument: unknown) => void, argument: unknown) =>
      script(argument),
  } as unknown as Page,
  12,
  { rows: 500, columns: 12 },
  "demo",
);

localStorage.setItem("theme", "dark");
const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
saved.state = { ...saved.state, autoFeatureVideos: false, easyMode: false, navInHeader: false };
localStorage.setItem("l8db.settings", JSON.stringify(saved));
const { createMemoryHistory } = await import("@tanstack/react-router");
const { router } = await import("../../src/router");
router.update({ history: createMemoryHistory({ initialEntries: ["/settings?tab=general"] }) });
await import("../../src/main");
