import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HotkeyKbd } from "@/components/hotkey-kbd";
import { IconButton } from "@/components/icon-button";
import { NewBadge } from "@/components/new-badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { splitHotkeyForKbd, useHotkeysStore } from "@/lib/hotkeys";
import {
  hasNewFeatures,
  NEW_FEATURES,
  type NewFeatureId,
  useHasAnyNewFeatures,
  useHasNewFeatures,
} from "@/lib/new-features";
import { scrollBehavior } from "@/lib/scroll-behavior";
import { useSettingsStore } from "@/lib/settings";

const target = window as unknown as { matchMedia?: (query: string) => { matches: boolean } };

afterEach(() => {
  delete target.matchMedia;
  useHotkeysStore.getState().resetAll();
  useSettingsStore.setState({ newFeatureBadges: true });
});

describe("reduced motion scrolling", () => {
  test("smooth scrolling falls back to an instant jump when motion is reduced", () => {
    expect(scrollBehavior()).toBe("smooth");
    target.matchMedia = (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" });
    expect(scrollBehavior()).toBe("auto");
    target.matchMedia = () => ({ matches: false });
    expect(scrollBehavior()).toBe("smooth");
  });
});

describe("hotkeys in tooltips", () => {
  test("the tooltip key follows a rebound shortcut", () => {
    const keys = () => renderToStaticMarkup(createElement(HotkeyKbd, { command: "query.run" }));
    const enter = splitHotkeyForKbd("Mod+Enter").at(-1) as string;
    expect(keys()).toContain(`>${enter}<`);
    useHotkeysStore.getState().setOverride("query.run", "Mod+Shift+R");
    const rebound = keys();
    expect(rebound).toContain(">R<");
    expect(rebound).not.toContain(`>${enter}<`);
    expect(rebound.match(/data-slot="kbd"/g)?.length).toBe(splitHotkeyForKbd("Mod+Shift+R").length);
  });

  test("an icon button keeps its key out of the markup until the tooltip opens", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(IconButton, { "aria-label": "Ausführen", "data-hotkey": "query.run" }),
      ),
    );
    expect(markup).toContain('aria-label="Ausführen"');
    expect(markup).toContain('data-hotkey="query.run"');
    expect(markup).not.toContain('data-slot="kbd"');
  });
});

describe("NEW-Hinweise setting", () => {
  const current = (Object.keys(NEW_FEATURES) as NewFeatureId[]).filter(
    (id) => NEW_FEATURES[id] === NEW_FEATURES["settings.appearance.new-feature-badges"],
  );

  function Probe({ scope }: { scope: string }) {
    const scoped = useHasNewFeatures(scope);
    const any = useHasAnyNewFeatures();
    return createElement("span", null, `${scoped}:${any}`, createElement(NewBadge));
  }

  test("off hides every badge, navigation dot and the mark-all action", () => {
    const version = NEW_FEATURES["settings.appearance.new-feature-badges"];
    expect(current.length).toBeGreaterThan(0);
    expect(hasNewFeatures("settings", new Set(), version, true)).toBe(true);
    const on = renderToStaticMarkup(createElement(Probe, { scope: "settings" }));
    expect(on).toContain("NEW");

    useSettingsStore.getState().setNewFeatureBadges(false);
    for (const id of current) expect(hasNewFeatures(id, new Set(), version, true)).toBe(false);
    expect(hasNewFeatures("settings", new Set(), version, true)).toBe(false);
    const off = renderToStaticMarkup(createElement(Probe, { scope: "settings" }));
    expect(off).toBe("<span>false:false</span>");
  });
});
