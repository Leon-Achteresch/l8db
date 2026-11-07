import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SmartPicker } from "../src/features/connections/provider-picker/smart-picker";
import type { ProviderInfo } from "../src/lib/db";

const kinds = ["postgres", "mysql", "mongodb", "redis", "sqlite"] as const;
const providers = Array.from({ length: 60 }, (_, index) => ({
  id: `p${index}`,
  name: `Provider ${index}`,
  group: "test",
  kind: kinds[index % kinds.length],
  default_port: 1,
  file_based: false,
  url_schemes: [],
  placeholder: "",
  hint: "",
  hosts: [],
  driver: {},
  capabilities: {},
  driver_status: { available: true },
})) as unknown as ProviderInfo[];
const extras = [
  { id: "supabase", name: "Supabase", category: "sql" as const, onSelect: () => {} },
  { id: "convex", name: "Convex", category: "documents" as const, onSelect: () => {} },
];

function render() {
  return renderToStaticMarkup(
    createElement(SmartPicker, { providers, selected: "", onSelect: () => {}, extras }),
  );
}

test("Supabase und Convex stehen in ihren Datenbank-Kategorien", () => {
  const markup = render();
  const sql = markup.indexOf("SQL-Datenbank");
  const documents = markup.indexOf("Dokumente &amp; NoSQL");
  const supabase = markup.indexOf('title="Supabase"');
  const convex = markup.indexOf('title="Convex"');
  expect(sql).toBeGreaterThan(-1);
  expect(supabase).toBeGreaterThan(sql);
  expect(convex).toBeGreaterThan(documents);
  expect(supabase).toBeLessThan(documents);
});

test("Picker mit 60 Anbietern und Extras rendert schnell", () => {
  const times: number[] = [];
  for (let index = 0; index < 200; index++) {
    const start = performance.now();
    render();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[100];
  const p95 = times[190];
  console.log(`smart-picker 60 providers: median ${median.toFixed(2)}ms p95 ${p95.toFixed(2)}ms`);
  expect(median).toBeLessThan(12);
  expect(p95).toBeLessThan(30);
});
