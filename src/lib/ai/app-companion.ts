import { featureShortcut } from "@/lib/ai/feature-search";
import { commandNeedle } from "@/lib/command-score";
import { useConnectionsStore } from "@/lib/connections";
import {
  expandSearchToken,
  FEATURE_CATALOG,
  featureAvailable,
  featureById,
  searchTokens,
} from "@/lib/discovery/catalog";
import type { FeatureEntry, FeatureSearchOptions } from "@/lib/discovery/types";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";

export const APP_FEATURE_LIMIT = 5;
export const APP_FEATURE_CHARS = 2000;

const searchIndex = new WeakMap<FeatureEntry, { title: string; text: string }>();

function rankedFeatures(
  query: string,
  options: FeatureSearchOptions,
  entries: readonly FeatureEntry[],
) {
  const tokens = searchTokens(query).slice(0, 12).map(expandSearchToken);
  const matches = [];
  for (const entry of entries) {
    if (!featureAvailable(entry, options)) continue;
    let indexed = searchIndex.get(entry);
    if (!indexed) {
      indexed = {
        title: commandNeedle(`${entry.title} ${entry.id}`),
        text: commandNeedle(`${entry.summary} ${entry.keywords.join(" ")}`),
      };
      searchIndex.set(entry, indexed);
    }
    let score = 0;
    for (const variants of tokens) {
      let best = 0;
      for (const variant of variants) {
        if (indexed.title.includes(variant)) best = Math.max(best, 3);
        else if (indexed.text.includes(variant)) best = Math.max(best, 1);
      }
      score += best;
    }
    if (score) matches.push({ entry, score });
  }
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, APP_FEATURE_LIMIT)
    .map(({ entry }) => entry);
}

export function searchAppFeatures(
  query: string,
  options: FeatureSearchOptions,
  entries: readonly FeatureEntry[] = FEATURE_CATALOG,
): string {
  if (!query.trim() || query.length > 200) return "[]";
  const hits = [];
  for (const entry of rankedFeatures(query, options, entries)) {
    const hit = {
      id: entry.id,
      title: entry.title,
      summary: entry.summary.slice(0, 120),
      shortcut: featureShortcut(entry),
      guide: Boolean(entry.steps?.length),
    };
    if (JSON.stringify([...hits, hit]).length > APP_FEATURE_CHARS) break;
    hits.push(hit);
  }
  return JSON.stringify(hits);
}

export interface AppUiTarget {
  signal: AbortSignal;
  openDocs: (path: string) => Promise<unknown>;
  showFeature?: (id: string, signal: AbortSignal) => Promise<string>;
  guideFeature?: (id: string, signal: AbortSignal) => Promise<boolean>;
}

async function showFeature(id: string, signal: AbortSignal): Promise<string> {
  const { highlightFeature } = await import("@/lib/discovery/highlight");
  if (signal.aborted) return "aborted";
  return highlightFeature(id, { signal });
}

async function guideFeature(id: string, signal: AbortSignal): Promise<boolean> {
  const { startGuide, stopGuide } = await import("@/lib/discovery/guide");
  if (signal.aborted) return false;
  const abort = () => stopGuide();
  const started = startGuide(id, {
    onEnd: () => signal.removeEventListener("abort", abort),
  });
  if (started) signal.addEventListener("abort", abort, { once: true });
  return started;
}

export async function handleAppRequest(
  details: unknown,
  target: AppUiTarget,
): Promise<{ ok: boolean; text: string }> {
  if (target.signal.aborted) return { ok: false, text: "Abgebrochen." };
  const args = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const { connections, activeId } = useConnectionsStore.getState();
  const connection = connections.find((entry) => entry.id === activeId);
  const options = {
    capabilities: connection ? capabilitiesFor(connection.kind) : null,
    easyMode: useSettingsStore.getState().easyMode,
  };
  if (args.action === "search") {
    if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 200)
      return { ok: false, text: "query braucht 1 bis 200 Zeichen." };
    return { ok: true, text: searchAppFeatures(args.query, options) };
  }
  if (typeof args.id !== "string" || args.id.length > 180)
    return { ok: false, text: "id aus app_search verwenden." };
  if (args.action === "open_doc") {
    if (!/^docs(?:\/[a-z0-9-]+)*$/.test(args.id)) return { ok: false, text: "Ungültige Doku-ID." };
    await target.openDocs(args.id === "docs" ? "" : args.id.slice(5));
    return { ok: true, text: `Dokumentation geöffnet: ${args.id}` };
  }
  const entry = featureById(args.id);
  if (!entry || !featureAvailable(entry, options))
    return { ok: false, text: "Feature hier nicht verfügbar; app_search verwenden." };
  if (args.action === "show_feature") {
    const outcome = await (target.showFeature ?? showFeature)(entry.id, target.signal);
    return {
      ok: outcome === "shown",
      text:
        outcome === "shown"
          ? `In der Oberfläche hervorgehoben: ${entry.title}`
          : `Feature konnte nicht gezeigt werden (${outcome}). Benötigte Ansicht oder Tabelle öffnen lassen.`,
    };
  }
  if (args.action === "guide_feature") {
    if (!entry.steps?.length)
      return { ok: false, text: "Für dieses Feature gibt es keine Anleitung." };
    const started = await (target.guideFeature ?? guideFeature)(entry.id, target.signal);
    return {
      ok: started,
      text: started
        ? `Anleitung gestartet: ${entry.title}. Der Benutzer folgt den Schritten in der Oberfläche.`
        : "Anleitung konnte nicht gestartet werden.",
    };
  }
  return { ok: false, text: "Unbekannte App-Aktion." };
}
