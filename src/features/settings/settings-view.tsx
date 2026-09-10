import { useHotkey } from "@tanstack/react-hotkeys";
import { getRouteApi } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";
import { SettingsAboutTab } from "@/features/settings/settings-about-tab";
import { SettingsDataTab } from "@/features/settings/settings-data-tab";
import { SettingsEditorTab } from "@/features/settings/settings-editor-tab";
import { SettingsExtensionsTab } from "@/features/settings/settings-extensions-tab";
import { SettingsGeneralTab } from "@/features/settings/settings-general-tab";
import { SettingsHotkeysTab } from "@/features/settings/settings-hotkeys-tab";
import { SettingsSearch } from "@/features/settings/settings-search";
import { SettingsSearchResults } from "@/features/settings/settings-search-results";
import { SettingsSecurityTab } from "@/features/settings/settings-security-tab";
import { SettingsSidebar } from "@/features/settings/settings-sidebar";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useResolvedHotkey } from "@/lib/hotkeys";

const settingsRouteApi = getRouteApi("/settings");

export function SettingsView() {
  const { tab: initialTab } = settingsRouteApi.useSearch();
  const [activeTab, setActiveTab] = useState(initialTab ?? "general");
  const [searchQuery, setSearchQuery] = useState("");
  const settingsSearchHotkey = useResolvedHotkey("settings.search");

  useHotkey(
    settingsSearchHotkey,
    (event) => {
      event.preventDefault();
      const searchInput = document.querySelector<HTMLInputElement>(
        'input[type="search"][placeholder*="Einstellungen"]',
      );
      searchInput?.focus();
      searchInput?.select();
    },
    { ignoreInputs: false },
  );

  return (
    <main
      className="workspace-canvas h-full w-full min-w-0 overflow-y-auto"
      data-tour="settings-page"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Einstellungen</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Konfiguriere Editor, Abfragegrenzen, Sicherheit und App-Verhalten.
            </p>
          </div>
          <div className="w-full sm:w-72">
            <SettingsSearch value={searchQuery} onChange={setSearchQuery} />
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="shrink-0">
            <div className="sticky top-8">
              <SettingsSidebar
                activeTab={activeTab}
                onSelectTab={(tab) => {
                  setActiveTab(tab);
                  setSearchQuery("");
                }}
              />
            </div>
          </aside>

          <section className="@container min-w-0 flex-1 overflow-x-clip">
            <motion.div
              key={searchQuery ? "search" : activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              layout
              transition-layout={{ layout: SPRING_LAYOUT }}
            >
              {searchQuery.trim() ? (
                <SettingsSearchResults
                  query={searchQuery}
                  onSelectTab={setActiveTab}
                  onClearQuery={() => setSearchQuery("")}
                />
              ) : (
                <>
                  {activeTab === "general" ? <SettingsGeneralTab /> : null}
                  {activeTab === "editor" ? <SettingsEditorTab /> : null}
                  {activeTab === "data" ? <SettingsDataTab /> : null}
                  {activeTab === "security" ? <SettingsSecurityTab /> : null}
                  {activeTab === "extensions" ? <SettingsExtensionsTab /> : null}
                  {activeTab === "hotkeys" ? <SettingsHotkeysTab /> : null}
                  {activeTab === "about" ? <SettingsAboutTab /> : null}
                </>
              )}
            </motion.div>
          </section>
        </div>
      </div>
    </main>
  );
}
