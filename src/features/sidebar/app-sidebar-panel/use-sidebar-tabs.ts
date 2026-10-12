import {
  ArchiveIcon,
  BracesIcon,
  EyeIcon,
  FileCodeIcon,
  LinkIcon,
  ListOrderedIcon,
  PackageIcon,
  SquareFunctionIcon,
  TableIcon,
  UsersIcon,
} from "lucide-react";
import { useActiveCapabilities } from "@/lib/db-selection";
import { useSettingsStore } from "@/lib/settings";

export function useSidebarTabs(hasPackages: boolean) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const caps = useActiveCapabilities();
  return [
    {
      value: "tables",
      label: caps.object_storage ? "Buckets" : "Tabellen",
      icon: caps.object_storage ? ArchiveIcon : TableIcon,
      enabled: true,
    },
    { value: "views", label: "Views", icon: EyeIcon, enabled: caps.views },
    { value: "functions", label: "Funktionen", icon: BracesIcon, enabled: caps.functions },
    {
      value: "procedures",
      label: "Prozeduren",
      icon: SquareFunctionIcon,
      enabled: caps.procedures,
    },
    {
      value: "packages",
      label: "Packages",
      icon: PackageIcon,
      enabled: hasPackages,
      featureScope: "sidebar.packages",
    },
    { value: "synonyms", label: "Synonyme", icon: LinkIcon, enabled: caps.synonyms },
    { value: "extensions", label: "Packages", icon: PackageIcon, enabled: caps.extensions },
    { value: "roles", label: "Benutzer", icon: UsersIcon, enabled: caps.roles },
    { value: "queries", label: "Queries", icon: FileCodeIcon, enabled: true },
    {
      value: "sequences",
      label: "Sequenzen",
      icon: ListOrderedIcon,
      enabled: !easyMode && caps.sequences,
    },
  ].filter((tab) => tab.enabled);
}
