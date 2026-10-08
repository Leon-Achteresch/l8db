import type { Page } from "playwright";
import { seedApp } from "./perf-app";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "connected";

await seedApp(
  {
    addInitScript: async (script: (arg: unknown) => unknown, arg: unknown) => script(arg),
  } as unknown as Page,
  Number(params.get("tables") ?? 3000),
);

if (mode === "welcome" || mode === "onboarding") {
  const connections = JSON.parse(localStorage.getItem("l8db.connections") ?? "{}");
  connections.state.connections = [];
  connections.state.activeId = null;
  localStorage.setItem("l8db.connections", JSON.stringify(connections));
}
if (mode === "onboarding") {
  const settings = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
  settings.state.onboardingDone = false;
  localStorage.setItem("l8db.settings", JSON.stringify(settings));
}

const { FALLBACK_PROVIDERS } = await import("../../src/lib/providers");
const internals = (
  window as unknown as {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
).__TAURI_INTERNALS__;
const originalInvoke = internals.invoke;
const metrics = { commands: {} as Record<string, number>, inFlight: 0, peakInFlight: 0 };
Object.assign(window, { appDesignMetrics: metrics });
internals.invoke = async (command, args) => {
  metrics.commands[command] = (metrics.commands[command] ?? 0) + 1;
  metrics.inFlight++;
  metrics.peakInFlight = Math.max(metrics.peakInFlight, metrics.inFlight);
  try {
    if (command === "list_providers") return FALLBACK_PROVIDERS;
    if (command === "driver_status")
      return FALLBACK_PROVIDERS.find((provider) => provider.kind === args?.kind)?.driver_status;
    return await originalInvoke(command, args);
  } finally {
    metrics.inFlight--;
  }
};

history.replaceState({}, "", params.get("route") ?? "/");
await import("../../src/main");
