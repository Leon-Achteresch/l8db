import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
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
  { id: "schemas", label: "Schemas", component: DatabaseSchemasTab },
  { id: "views", label: "Views", component: DatabaseViewsTab },
  { id: "functions", label: "Funktionen", component: DatabaseFunctionsTab },
  { id: "triggers", label: "Trigger", component: DatabaseTriggersTab },
  { id: "indexes", label: "Indizes", component: DatabaseIndexesTab },
  { id: "enums", label: "Enums", component: DatabaseEnumsTab },
  { id: "extensions", label: "Erweiterungen", component: DatabaseExtensionsTab },
  { id: "roles", label: "Rollen", component: DatabaseRolesTab },
  { id: "publications", label: "Publikationen", component: DatabasePublicationsTab },
  { id: "sequences", label: "Sequenzen", component: DatabaseSequencesTab },
];

export function SupabaseDatabaseSection({ project }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.database");
  const [tab, setTab] = useState("schemas");
  return (
    <div className="space-y-4">
      <h2 ref={feature.ref} className="flex items-center gap-2 text-base font-semibold">
        Datenbank {feature.isNew && <NewBadge />}
      </h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id} className="text-xs">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(({ id, component: Tab }) => (
          <TabsContent key={id} value={id} className="pt-3">
            {tab === id && <Tab reference={project.reference} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
