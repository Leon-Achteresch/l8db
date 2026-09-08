import { Blocks, CodeXml, Database, Info, Keyboard, ShieldCheck, Sliders } from "lucide-react";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useVisibleUpdate } from "@/lib/hooks/use-visible-update";
import { cn } from "@/lib/utils";

export interface SettingsTabItem {
  id: string;
  label: string;
  description: string;
  icon: typeof Sliders;
}

export const SETTINGS_TABS: SettingsTabItem[] = [
  {
    id: "general",
    label: "Allgemein",
    description: "Design & Oberfläche",
    icon: Sliders,
  },
  {
    id: "editor",
    label: "SQL-Editor",
    description: "Formatierung & Schrift",
    icon: CodeXml,
  },
  {
    id: "data",
    label: "Daten & Abfragen",
    description: "Limits & Transaktionen",
    icon: Database,
  },
  {
    id: "security",
    label: "Sicherheit & SSH",
    description: "Netzwerk & Keychain",
    icon: ShieldCheck,
  },
  {
    id: "extensions",
    label: "Erweiterungen",
    description: "Community Plugins",
    icon: Blocks,
  },
  {
    id: "hotkeys",
    label: "Tastenkürzel",
    description: "Shortcuts anpassen",
    icon: Keyboard,
  },
  {
    id: "about",
    label: "Über & Updates",
    description: "Version & Diagnose",
    icon: Info,
  },
];

interface SettingsSidebarProps {
  activeTab: string;
  onSelectTab: (id: string) => void;
}

export function SettingsSidebar({ activeTab, onSelectTab }: SettingsSidebarProps) {
  const update = useVisibleUpdate();

  return (
    <nav className="flex flex-col gap-1" aria-label="Einstellungskategorien">
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
              "group relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors outline-none",
              isActive
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {isActive ? (
              <motion.div
                layoutId="active-settings-tab-bg"
                transition={{ layout: SPRING_LAYOUT }}
                className="absolute inset-0 rounded-xl bg-muted/80 shadow-xs"
              />
            ) : null}
            <div
              className={cn(
                "relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted/70 text-muted-foreground group-hover:bg-muted group-hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {hasUpdate ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-background"
                />
              ) : null}
            </div>
            <div className="relative min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm">{tab.label}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{tab.description}</p>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
