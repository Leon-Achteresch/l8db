import {
  Braces,
  Eye,
  FolderTree,
  ListChecks,
  ListOrdered,
  ListTree,
  Package,
  Radio,
  Users,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SupabaseSectionTitle } from "../supabase-section-title";
import { SupabaseSidebarTabs } from "../supabase-sidebar-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { DatabaseEnumsTab } from "./database-enums-tab";
import { DatabaseExtensionsTab } from "./database-extensions-tab";
import { DatabaseFunctionsTab } from "./database-functions-tab";
import { DatabaseIndexesTab } from "./database-indexes-tab";
import { DatabasePublicationsTab } from "./database-publications-tab";
import { DatabaseRolesTab } from "./database-roles-tab";
import { DatabaseSchemasTab } from "./database-schemas-tab";
import { DatabaseSequencesTab } from "./database-sequences-tab";
import { DatabaseTriggersTab } from "./database-triggers-tab";
import { DatabaseViewsTab } from "./database-views-tab";

const TABS = [
  { id: "schemas", label: "Schemas", icon: FolderTree, component: DatabaseSchemasTab },
  { id: "views", label: "Views", icon: Eye, component: DatabaseViewsTab },
  { id: "functions", label: "Funktionen", icon: Braces, component: DatabaseFunctionsTab },
  { id: "triggers", label: "Trigger", icon: Zap, component: DatabaseTriggersTab },
  { id: "indexes", label: "Indizes", icon: ListTree, component: DatabaseIndexesTab },
  { id: "enums", label: "Enums", icon: ListChecks, component: DatabaseEnumsTab },
  { id: "extensions", label: "Erweiterungen", icon: Package, component: DatabaseExtensionsTab },
  { id: "roles", label: "Rollen", icon: Users, component: DatabaseRolesTab },
  { id: "publications", label: "Publikationen", icon: Radio, component: DatabasePublicationsTab },
  { id: "sequences", label: "Sequenzen", icon: ListOrdered, component: DatabaseSequencesTab },
];

export function SupabaseDatabaseSection({ project }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.database");
  const [tab, setTab] = useState("schemas");
  return (
    <div className="space-y-5">
      <SupabaseSectionHeader
        title={
          <SupabaseSectionTitle
            section="Datenbank"
            part={TABS.find((item) => item.id === tab)?.label}
          />
        }
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Schemas, Funktionen, Trigger, Indizes und weitere Postgres-Objekte."
      />
      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex-col">
        <SupabaseSidebarTabs
          label="Datenbankobjekte"
          items={TABS.map((item) => ({ value: item.id, label: item.label, icon: item.icon }))}
        />
        {TABS.map(({ id, component: Tab }) => (
          <TabsContent key={id} value={id}>
            {tab === id && <Tab reference={project.reference} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
