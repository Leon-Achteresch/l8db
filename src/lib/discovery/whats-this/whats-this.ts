import { FEATURE_CATALOG, type FeatureEntry, featureById } from "@/lib/discovery/catalog";
import { commandById } from "@/lib/hotkeys/commands";

export const WHATS_THIS_COMMAND = "help.whatsThis";

const TARGET = "[data-feature], [data-hotkey]";
const VALUE_SURFACES =
  'td, table, [role="grid"], [role="treegrid"], [role="gridcell"], [role="cell"], [role="row"], .monaco-editor, input, textarea, select, [contenteditable="true"], [contenteditable=""], [data-l8db-redact]';
const LABELLED =
  "button, a, label, h1, h2, h3, h4, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='switch'], [role='checkbox']";
const MAX_TEXT = 60;

export interface WhatsThisMatch {
  entry: FeatureEntry | null;
  feature: string | null;
  hotkey: string | null;
  anchor: Element | null;
}

let anchors: Map<string, FeatureEntry> | null = null;

function byAnchor(id: string): FeatureEntry | undefined {
  anchors ??= new Map(
    FEATURE_CATALOG.filter((entry) => entry.anchor).map((entry) => [entry.anchor as string, entry]),
  );
  return anchors.get(id);
}

export function catalogEntryForFeature(id: string): FeatureEntry | undefined {
  for (let current = id; current; ) {
    const entry = featureById(current) ?? byAnchor(current);
    if (entry) return entry;
    const dot = current.lastIndexOf(".");
    current = dot > 0 ? current.slice(0, dot) : "";
  }
  return undefined;
}

export function catalogEntryForHotkey(
  id: string,
  entries: readonly FeatureEntry[] = FEATURE_CATALOG,
): FeatureEntry | undefined {
  return entries.find((entry) => entry.hotkey === id);
}

export function resolveWhatsThis(element: Element): WhatsThisMatch {
  let feature: string | null = null;
  let hotkey: string | null = null;
  for (
    let node = element.closest(TARGET);
    node;
    node = node.parentElement?.closest(TARGET) ?? null
  ) {
    const nodeFeature = node.getAttribute("data-feature");
    const nodeHotkey = node.getAttribute("data-hotkey");
    feature ??= nodeFeature;
    hotkey ??= nodeHotkey;
    const entry =
      (nodeFeature ? catalogEntryForFeature(nodeFeature) : undefined) ??
      (nodeHotkey ? catalogEntryForHotkey(nodeHotkey) : undefined);
    if (entry) return { entry, feature, hotkey: hotkey ?? entry.hotkey ?? null, anchor: node };
  }
  return { entry: null, feature, hotkey, anchor: null };
}

function visibleLabel(element: Element): string {
  if (element.closest(VALUE_SURFACES)) return "";
  const labelled = element.closest(LABELLED);
  const raw =
    element.getAttribute("aria-label") ??
    labelled?.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    labelled?.textContent ??
    "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

export function describeElementForIssue(
  element: Element,
  pathname: string,
  match: WhatsThisMatch,
): string {
  const role = element.getAttribute("role");
  const label = visibleLabel(element);
  const command = match.hotkey ? commandById(match.hotkey) : undefined;
  const lines = [
    `Element: <${element.tagName.toLowerCase()}>${role ? ` role=${role}` : ""}${label ? ` „${label}“` : ""}`,
    match.feature ? `data-feature: ${match.feature}` : null,
    match.entry
      ? `Funktion: ${match.entry.title} (${match.entry.id})`
      : "Funktion: nicht im Katalog",
    command ? `Kürzel-Befehl: ${command.id}` : null,
    `Ansicht: ${pathname.split("?")[0]}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function issueDraftFor(description: string): string {
  return `Ich möchte ein Problem mit diesem Element melden und daraus ein Issue erstellen.\n\n${description}\n\nWas passiert: `;
}
