import type { Dashboard } from "@/lib/dashboards/model";

export const MAX_DASHBOARD_CSS_BYTES = 256 * 1024;
export const DASHBOARD_CSS_DELAY_MS = 180;
export type DashboardDesign = NonNullable<Dashboard["design"]>;
export const DEFAULT_DASHBOARD_DESIGN: DashboardDesign = { css: "", enabled: true };

export const DASHBOARD_DESIGN_SELECTORS = [
  [".dashboard-surface", "Gesamtes Dashboard und CSS-Variablen"],
  [".dashboard-toolbar", "Kopfzeile und Aktionen"],
  [".dashboard-header", "Marken-Kopfzeile mit Logo"],
  [".dashboard-header-title", "Markenname"],
  [".dashboard-nav", "Seitennavigation"],
  [".dashboard-nav-item", "Seiten-Link"],
  [".dashboard-selection", "Aktive Auswahl-Filter"],
  [".dashboard-filters", "Dashboard-Filter"],
  [".dashboard-canvas", "Scrollfläche"],
  [".dashboard-grid", "Chart-Raster"],
  [".dashboard-widget", "Chart-Karten"],
  [".dashboard-widget-header", "Karten-Kopfzeile"],
  [".dashboard-widget-title", "Titel"],
  [".dashboard-widget-subtitle", "Untertitel"],
  [".dashboard-widget-summary", "Kennzahlen und Legende"],
  [".dashboard-widget-content", "Diagramme und Tabellen"],
  ['[data-chart-type="kpi"]', "Ein Chart-Typ"],
  [".dashboard-block", "Inhaltsblöcke (Text, Bild, Button, Abschnitt)"],
  ['[data-block-type="text"]', "Ein Blocktyp"],
  ['[data-widget-id="…"]', "Eine bestimmte Karte"],
] as const;

export const DASHBOARD_DESIGN_PRESETS = [
  {
    name: "Glas",
    css: `.dashboard-surface {
  --background: oklch(0.22 0.04 255);
  --foreground: oklch(0.97 0.01 255);
  --card: oklch(0.3 0.04 255 / 70%);
  --muted-foreground: oklch(0.8 0.02 255);
  --border: oklch(0.8 0.03 255 / 25%);
  background: radial-gradient(at top left, #334d70, #141b2b);
}
.dashboard-widget {
  border-radius: 22px;
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 36px #0003;
}
.dashboard-widget-title { letter-spacing: 0.04em; }
`,
  },
  {
    name: "Papier",
    css: `.dashboard-surface {
  --background: oklch(0.97 0.015 85);
  --foreground: oklch(0.28 0.025 65);
  --card: oklch(0.995 0.006 85);
  --muted-foreground: oklch(0.5 0.02 65);
  --border: oklch(0.87 0.02 85);
  background: #f7f3ea;
  font-family: Georgia, serif;
}
.dashboard-widget { border-radius: 4px; box-shadow: 3px 3px 0 #d8cfbc; }
.dashboard-widget-title { font-size: 16px; }
`,
  },
  {
    name: "Neon",
    css: `.dashboard-surface {
  --background: oklch(0.15 0.02 280);
  --foreground: oklch(0.95 0.02 280);
  --card: oklch(0.2 0.03 280);
  --muted-foreground: oklch(0.75 0.03 280);
  --border: oklch(0.7 0.18 300 / 45%);
  --dash-accent: #c084fc !important;
  --dash-color-1: #c084fc;
  --dash-color-2: #22d3ee;
  background: #13101e;
}
.dashboard-widget { border-radius: 16px; box-shadow: 0 0 18px #a855f71c; }
.dashboard-widget-title { color: #e9d5ff; }
`,
  },
] as const;

export function validateDashboardDesign(value: unknown): asserts value is DashboardDesign {
  if (
    !value ||
    typeof value !== "object" ||
    !("css" in value) ||
    typeof value.css !== "string" ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean"
  )
    throw new Error("Dashboard-Design braucht CSS-Text und enabled (true/false).");
  if (new TextEncoder().encode(value.css).byteLength > MAX_DASHBOARD_CSS_BYTES)
    throw new Error("Das Dashboard-CSS darf höchstens 256 KiB groß sein.");
}

function rootSelectors(selector: string): string {
  if (!/:root|:scope|html|body|\.dashboard-surface/i.test(selector)) return selector;
  let result = "";
  let quote = "";
  let brackets = 0;
  let parentheses = 0;
  for (let i = 0; i < selector.length; ) {
    const char = selector[i];
    if (char === "\\") {
      result += selector.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (!brackets) {
      if (char === "(") parentheses++;
      else if (char === ")") parentheses--;
      const token = selector
        .slice(i)
        .match(/^(:(?:root|scope)|html|body|\.dashboard-surface)(?![\w-])/i)?.[0];
      const previous = selector[i - 1] ?? "";
      const alias = token?.startsWith(":") || token === ".dashboard-surface";
      const type =
        token &&
        !token.startsWith(".") &&
        !parentheses &&
        (!previous || !/[\w.#:\\-]/.test(previous));
      if (token && (alias || type)) {
        result += ":scope";
        i += token.length;
        continue;
      }
    }
    result += char;
    i++;
  }
  return result;
}

function selectorAliases(rules: CSSRuleList): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const selector = rule.selectorText;
      const next = rootSelectors(selector);
      if (next !== selector) rule.selectorText = next;
    }
    if (rule instanceof CSSGroupingRule) selectorAliases(rule.cssRules);
  }
}

type StylesheetSource = {
  css: string;
  scope: string;
  bodies?: number[];
  bindings: Map<
    number,
    { name: string; root: HTMLElement; property: string; value: string; priority: string }
  >;
};

const stylesheetSources = new WeakMap<CSSStyleSheet, StylesheetSource>();
const stylesheetOwners = new WeakMap<CSSStyleSheet, HTMLStyleElement>();

function indexedBodies(css: string, sheet: CSSStyleSheet): number[] | undefined {
  if (css.length < 32000 || css.includes(".dashboard-surface")) return;
  const rule = /\s*(?:\.[a-zA-Z_-][\w-]*)+\s*\{([^{};]+;?)\}/y;
  const bodies: number[] = [];
  while (rule.lastIndex < css.trimEnd().length) {
    const match = rule.exec(css);
    if (!match) return;
    bodies.push(rule.lastIndex - match[1].length - 1, rule.lastIndex - 1);
  }
  const scoped = sheet.cssRules[0] as CSSGroupingRule | undefined;
  return scoped?.cssRules.length === bodies.length / 2 ? bodies : undefined;
}

function literalDeclaration(body: string) {
  const match = body.match(/^\s*([a-zA-Z][\w-]*)\s*:\s*([#\w.%+\-\s]+?)\s*(!important)?\s*;?\s*$/i);
  if (!match) return;
  const value = match[2].trim();
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(value)) return;
  const property = match[1].toLowerCase();
  if (!CSS.supports(property, value)) return;
  return { property, value, priority: match[3] ? "important" : "" };
}

function updateLiteral(sheet: CSSStyleSheet, source: StylesheetSource, css: string): boolean {
  const bodies = source.bodies;
  const owner = stylesheetOwners.get(sheet);
  if (!bodies || !owner?.ownerDocument.adoptedStyleSheets.includes(sheet)) return false;
  let start = 0;
  while (start < source.css.length && source.css[start] === css[start]) start++;
  let previousEnd = source.css.length;
  let nextEnd = css.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    source.css[previousEnd - 1] === css[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }
  let low = 0;
  let high = bodies.length / 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bodies[middle * 2 + 1] < start) low = middle + 1;
    else high = middle;
  }
  const index = low * 2;
  if (index >= bodies.length || start < bodies[index] || previousEnd > bodies[index + 1])
    return false;
  const delta = css.length - source.css.length;
  const before = literalDeclaration(source.css.slice(bodies[index], bodies[index + 1]));
  const after = literalDeclaration(css.slice(bodies[index], bodies[index + 1] + delta));
  if (!before || !after || before.property !== after.property || before.priority !== after.priority)
    return false;
  const scoped = sheet.cssRules[0] as CSSGroupingRule;
  const rule = scoped.cssRules[low];
  if (!(rule instanceof CSSStyleRule)) return false;
  let binding = source.bindings.get(low);
  if (!binding) {
    const root = owner.ownerDocument.querySelector(source.scope);
    if (!(root instanceof HTMLElement)) return false;
    binding = { name: `--l8db-design-${crypto.randomUUID()}`, root, ...after };
    rule.style.setProperty(
      before.property,
      `var(${binding.name}, ${before.value})`,
      before.priority,
    );
    source.bindings.set(low, binding);
  }
  binding.root.style.setProperty(binding.name, after.value);
  binding.value = after.value;
  bodies[index + 1] += delta;
  if (delta) for (let i = index + 2; i < bodies.length; i++) bodies[i] += delta;
  source.css = css;
  return true;
}

function releaseStylesheet(sheet: CSSStyleSheet): void {
  const source = stylesheetSources.get(sheet);
  const scoped = sheet.cssRules[0] as CSSGroupingRule | undefined;
  for (const [index, binding] of source?.bindings ?? []) {
    const rule = scoped?.cssRules[index];
    if (rule instanceof CSSStyleRule)
      rule.style.setProperty(binding.property, binding.value, binding.priority);
    binding.root.style.removeProperty(binding.name);
  }
  source?.bindings.clear();
  stylesheetOwners.delete(sheet);
}

function replaceDashboardStylesheet(sheet: CSSStyleSheet, css: string, scope: string): void {
  if (!css.trim()) {
    sheet.replaceSync("");
    return;
  }
  sheet.replaceSync(`@scope (${scope}) {\n${css}\n}`);
  const scoped = sheet.cssRules[0] as CSSGroupingRule | undefined;
  if (!scoped?.cssRules?.length)
    throw new Error(
      "Keine gültige CSS-Regel gefunden. Beispiel: .dashboard-widget { color: red; }",
    );
  while (sheet.cssRules.length > 1) sheet.deleteRule(sheet.cssRules.length - 1);
  if (/\\|:root|:scope|html|body|\.dashboard-surface/i.test(css)) selectorAliases(scoped.cssRules);
}

export function compileDashboardStylesheet(
  css: string,
  scope: string,
  existing?: CSSStyleSheet,
): CSSStyleSheet {
  validateDashboardDesign({ css, enabled: true });
  if (css.trim() && !("CSSScopeRule" in globalThis))
    throw new Error("Eine aktuelle WebView mit CSS-@scope-Unterstützung ist erforderlich.");
  const existingSource = existing && stylesheetSources.get(existing);
  if (existing && existingSource?.scope === scope && existingSource.css === css) return existing;
  if (existing && existingSource?.scope === scope && updateLiteral(existing, existingSource, css))
    return existing;
  const sheet = new CSSStyleSheet();
  replaceDashboardStylesheet(sheet, css, scope);
  stylesheetSources.set(sheet, {
    css,
    scope,
    bodies: indexedBodies(css, sheet),
    bindings: new Map(),
  });
  return sheet;
}

const dashboardStylesheets = new WeakMap<HTMLStyleElement, CSSStyleSheet>();

export function dashboardStylesheet(style: HTMLStyleElement): CSSStyleSheet | undefined {
  return dashboardStylesheets.get(style);
}

export function applyDashboardStylesheet(style: HTMLStyleElement, sheet?: CSSStyleSheet): void {
  const current = dashboardStylesheets.get(style);
  const adopted = sheet?.cssRules.length ? sheet : undefined;
  if (current === adopted) return;
  const document = style.ownerDocument;
  const next = document.adoptedStyleSheets.filter((candidate) => candidate !== current);
  if (adopted) next.push(adopted);
  document.adoptedStyleSheets = next;
  if (current) releaseStylesheet(current);
  if (adopted) {
    dashboardStylesheets.set(style, adopted);
    stylesheetOwners.set(adopted, style);
  } else dashboardStylesheets.delete(style);
}

export function createDashboardStyleController(
  style: HTMLStyleElement,
  scope: string,
  onError: (message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let applied: string | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    update(design: DashboardDesign, immediate = false) {
      if (disposed) return;
      cancel();
      const apply = () => {
        timer = undefined;
        try {
          const next = design.enabled ? design.css : "";
          if (next !== applied) {
            applyDashboardStylesheet(
              style,
              compileDashboardStylesheet(next, scope, dashboardStylesheet(style)),
            );
            applied = next;
          }
          onError("");
        } catch (error) {
          onError(error instanceof Error ? error.message : "CSS konnte nicht geladen werden.");
        }
      };
      if (immediate || !design.enabled) apply();
      else timer = setTimeout(apply, DASHBOARD_CSS_DELAY_MS);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      applyDashboardStylesheet(style);
      style.remove();
    },
  };
}

export function dashboardDesignPrompt(dashboard: Dashboard, request: string): string {
  return `Gestalte das Design des bestehenden l8db-Dashboards ${JSON.stringify(dashboard.name)} (dashboard=${JSON.stringify(dashboard.mcpId ?? dashboard.id)}) nach diesem Wunsch: ${request}
Nutze das dashboard-Tool: get für das aktuelle Dashboard. Bevorzuge update mit theme (brand, tagline, logo als data:image/svg+xml, primary, background, surface, text, muted, border, palette, font, radius, card, density, header, nav; siehe chart_types) für Marke, Farben und Schrift und ergänze update mit design: {css: "vollständiges CSS", enabled: true} nur für Feinheiten, die das Theme nicht abdeckt. Inhaltsblöcke (text, image, link, divider) und Seiten darfst du ergänzen, wenn der Wunsch das verlangt. Lade das Tool bei Bedarf mit discover_tools. Erhalte Charts, Abfragen und Filter. Führe keine Datenbankabfragen aus.
CSS kann jede Eigenschaft und alle Unterelemente einschließlich SVG/Tabellen, Pseudoelementen, Animationen, Media Queries und CSS-Variablen gestalten. Regeln werden auf dieses Dashboard begrenzt. :root und :scope adressieren .dashboard-surface. Verwende eindeutige Namen für @keyframes und @font-face; externe Ressourcen unterliegen der App-CSP.
Stabile Selektoren: ${DASHBOARD_DESIGN_SELECTORS.map(([selector, description]) => `${selector}: ${description}`).join("; ")}.
Chart-Farben: --dash-accent, --dash-color-1 bis --dash-color-8, --dash-compare; Theme: --background, --foreground, --card, --border, --muted-foreground. Die Palette setzt --dash-accent eventuell inline, dann !important verwenden.
Seiten: ${JSON.stringify((dashboard.pages ?? []).map(({ id, name }) => ({ id, name })))}.
Karten: ${JSON.stringify(dashboard.widgets.map(({ id, title, chart, block, page }) => ({ id, title, ...(block ? { block: block.type } : { chart }), page })))}.
Aktuelles Theme: ${JSON.stringify({ ...(dashboard.theme ?? {}), logo: dashboard.theme?.logo ? "(gesetzt)" : undefined })}.
Aktuelles CSS: ${dashboard.design?.css ?? ""}`;
}
