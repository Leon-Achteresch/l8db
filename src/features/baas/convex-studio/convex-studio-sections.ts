import {
  CalendarClock,
  Code2,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  Settings,
  Table2,
} from "lucide-react";
import type { ComponentType } from "react";
import { ConvexDataSection } from "./data/convex-data-section";
import { ConvexEnvironmentSection } from "./environment/convex-environment-section";
import { ConvexFilesSection } from "./files/convex-files-section";
import { ConvexFunctionsSection } from "./functions/convex-functions-section";
import { ConvexLogsSection } from "./logs/convex-logs-section";
import { ConvexOverviewSection } from "./overview/convex-overview-section";
import { ConvexSchedulesSection } from "./schedules/convex-schedules-section";
import { ConvexSettingsSection } from "./settings/convex-settings-section";

export interface ConvexStudioDeployment {
  profileId: string;
  projectId: number;
  deploymentName: string;
  title: string;
  url: string | null;
  selfHosted: boolean;
}

export interface ConvexStudioSectionProps {
  deployment: ConvexStudioDeployment;
}

export type ConvexStudioSectionId =
  | "overview"
  | "data"
  | "functions"
  | "logs"
  | "files"
  | "schedules"
  | "environment"
  | "settings";

export interface ConvexStudioSection {
  id: ConvexStudioSectionId;
  label: string;
  icon: LucideIcon;
  component: ComponentType<ConvexStudioSectionProps>;
}

export const CONVEX_STUDIO_SECTIONS: ConvexStudioSection[] = [
  {
    id: "overview",
    label: "Übersicht",
    icon: LayoutDashboard,
    component: ConvexOverviewSection,
  },
  {
    id: "data",
    label: "Daten",
    icon: Table2,
    component: ConvexDataSection,
  },
  {
    id: "functions",
    label: "Funktionen",
    icon: Code2,
    component: ConvexFunctionsSection,
  },
  {
    id: "logs",
    label: "Logs",
    icon: ScrollText,
    component: ConvexLogsSection,
  },
  {
    id: "files",
    label: "Dateien",
    icon: FolderOpen,
    component: ConvexFilesSection,
  },
  {
    id: "schedules",
    label: "Zeitpläne",
    icon: CalendarClock,
    component: ConvexSchedulesSection,
  },
  {
    id: "environment",
    label: "Umgebung",
    icon: KeyRound,
    component: ConvexEnvironmentSection,
  },
  {
    id: "settings",
    label: "Einstellungen",
    icon: Settings,
    component: ConvexSettingsSection,
  },
];
