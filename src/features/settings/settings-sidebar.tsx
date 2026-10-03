import { Blocks, CodeXml, Database, Info, Keyboard, ShieldCheck, Sliders } from "lucide-react";
import { motion } from "motion/react";
import { NewBadge } from "@/components/new-badge";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useVisibleUpdate } from "@/lib/hooks/use-visible-update";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";

export interface SettingsTabItem {
  id: string;
  label: string;
  icon: typeof Sliders;
}

export const SETTINGS_TABS: SettingsTabItem[] = [
  {
    id: "general",
    label: "Allgemein",
    icon: Sliders,
  },
  {
    id: "editor",
    label: "SQL-Editor",
    icon: CodeXml,
  },
  {
    id: "data",
    label: "Daten & Abfragen",
    icon: Database,
  },
  {
    id: "security",
    label: "Sicherheit & SSH",
    icon: ShieldCheck,
  },
  {
    id: "extensions",
    label: "Erweiterungen",
    icon: Blocks,
  },
  {
    id: "hotkeys",
    label: "Tastenkürzel",
    icon: Keyboard,
  },
  {
    id: "about",
    label: "Über & Updates",
    icon: Info,
  },
];

interface SettingsSidebarProps {
  activeTab: string;
  onSelectTab: (id: string) => void;
}

export function SettingsSidebar({ activeTab, onSelectTab }: SettingsSidebarProps) {
  const update = useVisibleUpdate();
  const seenFeatures = useSeenNewFeatures();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Einstellungskategorien">
      {SETTINGS_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const hasUpdate = tab.id === "about" && Boolean(update);

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            className={cn(
              "group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[calc(0.375rem+var(--ui-density-step)/2)] text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              isActive
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {isActive ? (
              <motion.div
                layoutId="active-settings-tab-bg"
                transition={{ layout: SPRING_LAYOUT }}
                className="absolute inset-0 rounded-md bg-muted"
              />
            ) : null}
            <div
              className={cn(
                "relative flex size-4 shrink-0 items-center justify-center",
                isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {hasUpdate ? (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 size-2 rounded-full bg-red-500 ring-2 ring-background"
                />
              ) : null}
            </div>
            <div className="relative min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate">{tab.label}</span>
                {hasNewFeatures(`settings.${tab.id}`, seenFeatures) ? <NewBadge /> : null}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
