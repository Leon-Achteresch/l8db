import { useHotkey } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { ListFilter } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsAboutTab } from "@/features/settings/settings-about-tab";
import { SettingsAppearanceTab } from "@/features/settings/settings-appearance-tab";
import { SettingsDataTab } from "@/features/settings/settings-data-tab";
import { SettingsEditorTab } from "@/features/settings/settings-editor-tab";
import { SettingsExtensionsTab } from "@/features/settings/settings-extensions-tab";
import { SettingsGeneralTab } from "@/features/settings/settings-general-tab";
import { SettingsHotkeysTab } from "@/features/settings/settings-hotkeys-tab";
import { SettingsSearch } from "@/features/settings/settings-search";
import { SettingsSearchResults } from "@/features/settings/settings-search-results";
import { SettingsSecurityTab } from "@/features/settings/settings-security-tab";
import { SETTINGS_TABS, SettingsSidebar } from "@/features/settings/settings-sidebar";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useModifiedSettings } from "@/lib/hooks/use-modified-settings";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { useResolvedHotkey } from "@/lib/hotkeys";
import { useSettingsViewState } from "@/lib/settings-view-state";

export function SettingsView() {
  const routeCategory = useRouterSelect((state) =>
    state.location.pathname === "/settings"
      ? (state.location.search as { tab?: string }).tab
      : undefined,
  );
  const routeSetting = useRouterSelect((state) =>
    state.location.pathname === "/settings"
      ? (state.location.search as { setting?: string }).setting
      : undefined,
  );
  const navigate = useNavigate();
  const { category, query, modifiedOnly, setCategory, setQuery, setModifiedOnly } =
    useSettingsViewState();
  const { modified } = useModifiedSettings();
  const { ref: featureRef } = useNewFeatureVisibility<HTMLDivElement>(
    "settings.general.workspace-tab",
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const searchHotkey = useResolvedHotkey("settings.search");

  useEffect(() => {
    if (
      routeCategory &&
      SETTINGS_TABS.some((tab) => tab.id === routeCategory) &&
      routeCategory !== useSettingsViewState.getState().category
    )
      setCategory(routeCategory);
  }, [routeCategory, setCategory]);

  useEffect(() => {
    if (
      !routeSetting ||
      query.trim() ||
      modifiedOnly ||
      (routeCategory && routeCategory !== category)
    )
      return;
    const frame = requestAnimationFrame(() => {
      const target = contentRef.current?.querySelector<HTMLElement>(
        `[data-setting-id="${CSS.escape(routeSetting)}"]`,
      );
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [routeSetting, routeCategory, category, query, modifiedOnly]);

  useHotkey(
    searchHotkey,
    (event) => {
      event.preventDefault();
      const input = contentRef.current
        ?.closest("main")
        ?.querySelector<HTMLInputElement>('input[type="search"]');
      input?.focus();
      input?.select();
    },
    { ignoreInputs: false },
  );

  const selectCategory = (tab: string, setting?: string) => {
    setCategory(tab);
    void navigate({ to: "/settings", search: { tab, setting }, replace: true });
  };

  return (
    <main
      className="workspace-canvas h-full w-full min-w-0 overflow-y-auto"
      data-tour="settings-page"
    >
      <div ref={featureRef} className="mx-auto w-full max-w-6xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Einstellungen</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Konfiguriere Editor, Abfragegrenzen, Sicherheit und App-Verhalten.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="min-w-48 flex-1 sm:w-72">
              <SettingsSearch value={query} onChange={setQuery} />
            </div>
            <Button
              type="button"
              variant={modifiedOnly ? "secondary" : "outline"}
              size="sm"
              aria-pressed={modifiedOnly}
              onClick={() => setModifiedOnly(!modifiedOnly)}
            >
              <ListFilter className="size-3.5" />
              Nur geänderte
              <Badge variant="secondary" className="tabular-nums">
                {modified.size}
              </Badge>
            </Button>
          </div>
        </header>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="shrink-0">
            <div className="sticky top-8">
              <SettingsSidebar activeTab={category} onSelectTab={selectCategory} />
            </div>
          </aside>
          <section
            className="@container min-w-0 flex-1 overflow-x-clip"
            aria-label="Einstellungsoptionen"
          >
            <motion.div
              ref={contentRef}
              key={query.trim() || modifiedOnly ? "search" : category}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              layout
              transition-layout={{ layout: SPRING_LAYOUT }}
            >
              {query.trim() || modifiedOnly ? (
                <SettingsSearchResults
                  query={query}
                  modifiedOnly={modifiedOnly}
                  modified={modified}
                  onSelectSetting={selectCategory}
                  onClearQuery={() => {
                    setQuery("");
                    setModifiedOnly(false);
                  }}
                />
              ) : (
                <>
                  {category === "general" ? <SettingsGeneralTab /> : null}
                  {category === "appearance" ? <SettingsAppearanceTab /> : null}
                  {category === "editor" ? <SettingsEditorTab /> : null}
                  {category === "data" ? <SettingsDataTab /> : null}
                  {category === "security" ? <SettingsSecurityTab /> : null}
                  {category === "extensions" ? <SettingsExtensionsTab /> : null}
                  {category === "hotkeys" ? <SettingsHotkeysTab /> : null}
                  {category === "about" ? <SettingsAboutTab /> : null}
                </>
              )}
            </motion.div>
          </section>
        </div>
      </div>
    </main>
  );
}
