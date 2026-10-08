import type { Dashboard } from "@/lib/dashboards/model";

export const MAX_DASHBOARD_CSS_BYTES = 256 * 1024;
export const DASHBOARD_CSS_DELAY_MS = 180;
export type DashboardDesign = NonNullable<Dashboard["design"]>;
export const DEFAULT_DASHBOARD_DESIGN: DashboardDesign = { css: "", enabled: true };

export const DASHBOARD_DESIGN_SELECTORS = [
  [".dashboard-surface", "Gesamtes Dashboard und CSS-Variablen"],
  [".dashboard-toolbar", "Kopfzeile und Aktionen"],
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
  if (!/:root|:scope|html|body|\.dashboard-surface/.test(selector)) return selector;
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
      if (token && (alias || (!parentheses && (!previous || !/[\w.#:\\-]/.test(previous))))) {
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

const stylesheetSources = new WeakMap<CSSStyleSheet, { css: string; scope: string }>();

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
  selectorAliases(scoped.cssRules);
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
  const sheet = existing && existingSource?.scope === scope ? existing : new CSSStyleSheet();
  const previous = stylesheetSources.get(sheet);
  try {
    replaceDashboardStylesheet(sheet, css, scope);
    stylesheetSources.set(sheet, { css, scope });
    return sheet;
  } catch (error) {
    if (previous) replaceDashboardStylesheet(sheet, previous.css, previous.scope);
    throw error;
  }
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
  if (adopted) dashboardStylesheets.set(style, adopted);
  else dashboardStylesheets.delete(style);
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
Nutze das dashboard-Tool: get für das aktuelle Dashboard, update mit design: {css: "vollständiges CSS", enabled: true}. Lade es bei Bedarf mit discover_tools. Verändere nur das Design, erhalte Charts, Abfragen, Filter und Layout. Führe keine Datenbankabfragen aus.
CSS kann jede Eigenschaft und alle Unterelemente einschließlich SVG/Tabellen, Pseudoelementen, Animationen, Media Queries und CSS-Variablen gestalten. Regeln werden auf dieses Dashboard begrenzt. :root und :scope adressieren .dashboard-surface. Verwende eindeutige Namen für @keyframes und @font-face; externe Ressourcen unterliegen der App-CSP.
Stabile Selektoren: ${DASHBOARD_DESIGN_SELECTORS.map(([selector, description]) => `${selector}: ${description}`).join("; ")}.
Chart-Farben: --dash-accent, --dash-color-1 bis --dash-color-8, --dash-compare; Theme: --background, --foreground, --card, --border, --muted-foreground. Die Palette setzt --dash-accent eventuell inline, dann !important verwenden.
Karten: ${JSON.stringify(dashboard.widgets.map(({ id, title, chart }) => ({ id, title, chart })))}.
Aktuelles CSS: ${dashboard.design?.css ?? ""}`;
}
