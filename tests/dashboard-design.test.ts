import { expect, test } from "bun:test";
import {
  dashboardDesignPrompt,
  MAX_DASHBOARD_CSS_BYTES,
  validateDashboardDesign,
} from "../src/lib/dashboard-design";
import type { Dashboard } from "../src/lib/dashboards/model";

test("free CSS accepts all properties, nesting, keyframes and font declarations", () => {
  expect(() =>
    validateDashboardDesign({
      css: "@font-face { font-family: Custom; src: url(data:font/woff2;base64,AA); } @keyframes glow { to { filter: blur(2px); } } :root { --custom: 1; } .dashboard-widget { & svg { fill: pink; } animation: glow 1s; }",
      enabled: true,
    }),
  ).not.toThrow();
  expect(() => validateDashboardDesign({ css: "", enabled: false })).not.toThrow();
});

test("design validation bounds UTF-8 storage and rejects malformed values", () => {
  expect(() =>
    validateDashboardDesign({ css: "a".repeat(MAX_DASHBOARD_CSS_BYTES), enabled: true }),
  ).not.toThrow();
  expect(() =>
    validateDashboardDesign({ css: "ü".repeat(MAX_DASHBOARD_CSS_BYTES / 2 + 1), enabled: true }),
  ).toThrow("256 KiB");
  for (const value of [
    null,
    "css",
    {},
    { css: false, enabled: true },
    { css: "", enabled: "true" },
  ])
    expect(() => validateDashboardDesign(value)).toThrow();
});

test("AI design request targets the current dashboard and preserves its data", () => {
  const dashboard = {
    id: "local",
    mcpId: "managed",
    name: "Sales",
    widgets: [{ id: "revenue", title: "Revenue", chart: "kpi" }],
    design: { css: ".dashboard-widget { color: red; }", enabled: true },
  } as Dashboard;
  const prompt = dashboardDesignPrompt(dashboard, "Alles violett");
  expect(prompt).toContain('dashboard="managed"');
  expect(prompt).toContain("Alles violett");
  expect(prompt).toContain("Führe keine Datenbankabfragen aus");
  expect(prompt).toContain(".dashboard-widget { color: red; }");
  expect(prompt).toContain("revenue");
  expect(prompt).toContain("design:");
});
