import { CodeIcon, Columns2Icon, TableIcon } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { id: "data", label: "Daten", icon: TableIcon },
  { id: "columns", label: "Spalten", icon: Columns2Icon },
  { id: "definition", label: "Definition", icon: CodeIcon },
];

export function BaasTableTabs({ definition }: { definition?: boolean }) {
  return (
    <TabsList variant="line" className="h-9 w-max shrink-0" aria-label="Tabellenansichten">
      {TABS.filter((tab) => tab.id !== "definition" || definition).map(
        ({ id, label, icon: Icon }) => (
          <TabsTrigger key={id} value={id}>
            <Icon className="size-3.5" />
            {label}
          </TabsTrigger>
        ),
      )}
    </TabsList>
  );
}
